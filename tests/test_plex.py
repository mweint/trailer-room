import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit

import plex


class FakePlex:
    def __init__(self):
        self.owner = "test-user"
        self.offline = False
        self.calls = []

    def __call__(self, url, client, token=None, method="GET"):
        self.calls.append(url)
        parsed = urlsplit(url)
        if parsed.path == "/api/v2/pins":
            assert method == "POST"
            return {"code": "test-pin", "id": 123, "expiresIn": 900}
        if parsed.path == "/api/v2/pins/123":
            return {"authToken": "account-token"}
        if parsed.path == "/api/v2/user":
            assert token == "account-token"
            return {"id": self.owner}
        if parsed.path == "/api/v2/resources":
            assert token == "account-token"
            return [{"provides": "server", "name": label, "clientIdentifier": id_,
                     "accessToken": "server-token", "connections": [{"uri": f"https://{id_}.example"}]}
                    for id_, label in (("home", "Home Cinema"), ("other", "Other server"))]
        assert token == "server-token"
        if self.offline:
            raise OSError("Server offline")
        if parsed.path == "/library/sections":
            libraries = [{"key": "7", "title": "Festival picks", "type": "movie", "uuid": "seven"}]
            if parsed.hostname == "home.example":
                libraries.extend([{"key": "8", "title": "Family", "type": "movie", "uuid": "eight"},
                                  {"key": "9", "title": "TV", "type": "show", "uuid": "nine"}])
            return {"MediaContainer": {"Directory": libraries}}
        if parsed.path == "/library/sections/8/all":
            return {"MediaContainer": {"size": 0, "totalSize": 0}}
        assert parsed.path == "/library/sections/7/all"
        offset = int(parse_qs(parsed.query)["X-Plex-Container-Start"][0])
        film = {"title": "Feature", "type": "movie", "year": 1999, "duration": 6000000, "contentRating": "PG",
                "Guid": [{"id": "imdb://tt1234567"}]}
        entries = ([film, dict(film, title="Short", duration=60000)] if offset == 0 else
                   [dict(film, title="Tagged short", Genre=[{"tag": "Short"}]), film])
        return {"MediaContainer": {"size": len(entries), "totalSize": 4, "offset": offset, "Metadata": entries}}


class PlexTests(unittest.TestCase):
    def setUp(self):
        tmp = TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        self.source = plex.PlexSource(self.root, dict)
        self.remote = FakePlex()
        self.addCleanup(patch.stopall)
        patch("plex.request", side_effect=self.remote).start()

    def sign_in(self):
        start = self.source.begin("http://localhost:8765")
        self.assertIn("app.plex.tv/auth#", start["url"])
        flow = {"flow": start["flow"]}
        servers = self.source.action("servers", flow)["servers"]
        self.assertEqual([s["name"] for s in servers], ["Home Cinema", "Other server"])
        return flow

    def snapshot(self):
        return self.source.include({"sources": {}, "catalogs": {}})

    def test_owner_browser_removal_works_offline_after_restart(self):
        flow = dict(self.sign_in(), server="home")
        self.source.action("libraries", flow)
        key = self.source.action("connect", dict(flow, library="7"))["device_key"]
        self.source = plex.PlexSource(self.root, dict)
        body = {"connection": self.snapshot()["plex"]["connection"]}
        self.assertNotIn(key, self.source.path.read_text())
        self.assertNotIn(key, json.dumps(self.snapshot()))
        with patch("plex.request", side_effect=AssertionError("Unexpected network request")):
            self.assertTrue(self.source.action("disconnect", body, "wrong")["signInRequired"])
            with self.assertRaises(plex.PlexError):
                self.source.action("disconnect", {"connection": "old-library"}, key)
            self.source.action("disconnect", body, key)
        self.assertFalse(self.source.path.exists())

    def test_existing_installation_removal_only_needs_owner_sign_in(self):
        flow = dict(self.sign_in(), server="home")
        self.source.action("libraries", flow)
        self.source.action("connect", dict(flow, library="7"))
        legacy = dict(self.source.saved)
        del legacy["device_hash"], legacy["connection"]
        self.source.write(legacy)
        self.source = plex.PlexSource(self.root, dict)
        body = {"connection": self.snapshot()["plex"]["connection"]}
        self.assertTrue(self.source.action("disconnect", body)["signInRequired"])
        self.remote.owner = "another-account"
        with patch("plex.discover", side_effect=AssertionError("Unnecessary discovery")):
            for owner in ("another-account", "test-user"):
                self.remote.owner = owner
                body["flow"] = self.source.begin("http://localhost:8765")["flow"]
                if owner == "another-account":
                    with self.assertRaises(plex.PlexError):
                        self.source.action("disconnect", body)
                else:
                    self.source.action("disconnect", body)
        self.assertFalse(self.source.path.exists())

    def test_explicit_choices_import_refresh_restart_and_disconnect(self):
        self.assertEqual(self.snapshot()["sources"], {})
        self.assertFalse(self.remote.calls)
        flow = dict(self.sign_in(), server="other")
        with self.assertRaises(plex.PlexError):
            self.source.action("connect", dict(flow, library="7"))
        self.assertEqual(self.source.action("libraries", flow)["libraries"], [{"id": "7", "name": "Festival picks"}])
        with self.assertRaises(plex.PlexError):
            self.source.action("connect", flow)
        self.assertFalse(self.source.path.exists())
        flow["server"] = "home"
        choices = self.source.action("libraries", flow)["libraries"]
        self.assertEqual([c["name"] for c in choices], ["Family", "Festival picks"])
        with self.assertRaises(plex.PlexError):
            self.source.action("connect", dict(flow, library="9"))
        self.source.action("connect", dict(flow, library="7"))
        self.assertFalse(any("/8/all" in url for url in self.remote.calls))
        self.source = plex.PlexSource(self.root, dict)
        snapshot = self.snapshot()
        self.assertEqual(snapshot["sources"]["plex-7"]["name"], "Festival picks")
        self.assertEqual([r["title"] for r in snapshot["catalogs"]["plex-7"]], ["Feature"])
        self.assertNotIn("token", json.dumps(snapshot))
        self.assertNotIn("account-token", self.source.path.read_text())
        self.remote.offline = True
        self.source.running = self.source.saved
        self.source.update(self.source.saved)
        self.assertTrue(self.snapshot()["sources"]["plex-7"]["error"])
        self.assertEqual(self.snapshot()["catalogs"]["plex-7"], snapshot["catalogs"]["plex-7"])
        self.remote.offline = False
        flow = dict(self.sign_in(), server="home")
        self.source.action("libraries", flow)
        with patch("plex.film_rows", side_effect=OSError):
            with self.assertRaises(OSError):
                self.source.action("connect", dict(flow, library="8"))
        self.assertEqual(self.snapshot()["sources"]["plex-7"]["name"], "Festival picks")
        self.source.action("connect", dict(flow, library="8"))
        self.assertEqual(self.snapshot()["catalogs"]["plex-8"], [])
        self.assertNotIn("plex-7", self.snapshot()["catalogs"])
        self.remote.owner = "someone-else"
        with self.assertRaises(plex.PlexError):
            self.sign_in()
        self.remote.owner = "test-user"
        self.source.action("disconnect", self.sign_in())
        self.assertFalse(self.source.path.exists())
        self.assertEqual(self.snapshot()["sources"], {})

    def test_several_libraries_are_separate_sources(self):
        flow = dict(self.sign_in(), server="home")
        self.source.action("libraries", flow)
        with self.assertRaises(plex.PlexError):
            self.source.action("connect", dict(flow, library="7,9"))
        self.source.action("connect", dict(flow, library="7,8"))
        snapshot = self.snapshot()
        self.assertEqual(snapshot["plex"]["libraries"], ["plex-7", "plex-8"])
        self.assertEqual(snapshot["plex"]["server"], "Home Cinema")
        self.assertEqual([snapshot["sources"][s]["name"] for s in ("plex-7", "plex-8")], ["Festival picks", "Family"])
        self.assertEqual(len(snapshot["catalogs"]["plex-7"]), 1)

    def test_connecting_browser_changes_libraries_without_signing_in(self):
        flow = dict(self.sign_in(), server="home")
        self.source.action("libraries", flow)
        key = self.source.action("connect", dict(flow, library="7"))["device_key"]
        self.assertTrue(self.source.action("manage", {}, "wrong")["signInRequired"])
        self.assertTrue(self.source.action("connect", {"library": "8"}, "")["signInRequired"])
        with patch("plex.discover", side_effect=AssertionError("No sign-in needed")):
            listed = self.source.action("manage", {}, key)
            self.assertEqual(listed["server"], "Home Cinema")
            self.assertEqual([c["name"] for c in listed["libraries"]], ["Family", "Festival picks"])
            with self.assertRaises(plex.PlexError):
                self.source.action("connect", {"library": "9"}, key)
            self.assertEqual(self.source.action("connect", {"library": "7,8"}, key), {})
        self.assertEqual(self.snapshot()["plex"]["libraries"], ["plex-7", "plex-8"])

    def test_single_library_file_from_before_is_read(self):
        old = {"owner": "test-user", "server": {"name": "Home Cinema", "client": "c", "urls": [], "token": "t"},
               "key": "7", "library": {"name": "Festival picks", "uuid": "seven"}, "connection": "abc",
               "rows": [{"title": "Feature", "year": 1999}], "updated": 1, "attempted": 1, "error": ""}
        self.source.path.write_text(json.dumps(old), encoding="utf-8")
        self.source = plex.PlexSource(self.root, dict)
        with patch.object(self.source, "refresh"):
            snapshot = self.snapshot()
        self.assertEqual(snapshot["plex"], {"server": "Home Cinema", "connection": "abc", "libraries": ["plex-7"]})
        self.assertEqual(snapshot["catalogs"]["plex-7"], [{"title": "Feature", "year": 1999}])
