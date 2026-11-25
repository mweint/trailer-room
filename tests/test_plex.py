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
        self.assertEqual(snapshot["sources"]["plex"]["name"], "Festival picks")
        self.assertEqual([r["title"] for r in snapshot["catalogs"]["plex"]], ["Feature"])
        self.assertNotIn("token", json.dumps(snapshot))
        self.assertNotIn("account-token", self.source.path.read_text())
        self.remote.offline = True
        self.source.running = self.source.saved
        self.source.update(self.source.saved)
        self.assertTrue(self.snapshot()["sources"]["plex"]["error"])
        self.assertEqual(self.snapshot()["catalogs"]["plex"], snapshot["catalogs"]["plex"])
        self.remote.offline = False
        flow = dict(self.sign_in(), server="home")
        self.source.action("libraries", flow)
        with patch("plex.film_rows", side_effect=OSError):
            with self.assertRaises(OSError):
                self.source.action("connect", dict(flow, library="8"))
        self.assertEqual(self.snapshot()["sources"]["plex"]["name"], "Festival picks")
        self.source.action("connect", dict(flow, library="8"))
        self.assertEqual(self.snapshot()["catalogs"]["plex"], [])
        self.remote.owner = "someone-else"
        with self.assertRaises(plex.PlexError):
            self.sign_in()
        self.remote.owner = "test-user"
        self.source.action("disconnect", self.sign_in())
        self.assertFalse(self.source.path.exists())
        self.assertEqual(self.snapshot()["sources"], {})
