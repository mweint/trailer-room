import json
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Event
import time
import unittest
from unittest.mock import patch

import catalogs


class NearestYearTests(unittest.TestCase):
    def test_exact_year_wins_then_nearest_within_slack(self):
        self.assertEqual(catalogs.nearest([("2023", "premiere")], "2025"), "premiere")
        self.assertEqual(catalogs.nearest([("1977", "old"), ("2018", "remake")], "2018"), "remake")
        self.assertEqual(catalogs.nearest([("2018-10-26", "dated")], 2019), "dated")
        self.assertIsNone(catalogs.nearest([("1977", "old")], "2018"))
        self.assertIsNone(catalogs.nearest([("2016", "a"), ("2020", "b")], "2018"))
        self.assertIsNone(catalogs.nearest([("2023", "a")], ""))

    def test_distributor_release_year_still_finds_the_film(self):
        rows = [{"title": "Hell of a Summer", "year": "2025"}]
        known = [{"title": "Hell of a Summer", "year": "2023", "imdb": "tt21267296"}]
        with patch("catalogs.wikidata", return_value=[]):
            catalogs.enrich("neon", rows, known)
        self.assertEqual(rows[0]["imdb"], "tt21267296")


class SameFilmTests(unittest.TestCase):
    def test_edition_in_the_title_matches_only_with_a_shared_director(self):
        row = {"title": "Possessor Uncut", "year": "2020", "directors": ["Brandon Cronenberg"]}
        film = ("Possessor", "2020", "tt5918982")
        asked = []
        directors = lambda item: asked.append(item) or ["Brandon Cronenberg"]
        self.assertEqual(catalogs.same_film(row, [film, ("The Possessors", "1958", "x")], directors), "tt5918982")
        self.assertEqual(asked, ["tt5918982"])
        self.assertIsNone(catalogs.same_film(row, [film], lambda item: ["Someone Else"]))
        self.assertIsNone(catalogs.same_film(dict(row, directors=[]), [film], directors))
        self.assertIsNone(catalogs.same_film(row, [film]))
        colon = {"title": "Infinity Pool: Uncut", "year": "2023", "directors": ["Brandon Cronenberg"]}
        self.assertEqual(catalogs.same_film(colon, [("Infinity Pool", "2023", "pool")], directors), "pool")

    def test_same_title_needs_no_director_and_wins(self):
        row = {"title": "Amélie", "year": "2001", "directors": ["Jean-Pierre Jeunet"]}
        never = lambda item: self.fail("directors looked up for an exact title")
        self.assertEqual(catalogs.same_film(row, [("Amelie", "2001", "a"), ("Amelie 2", "2001", "b")], never), "a")

    def test_director_picks_between_films_with_the_same_title_and_year(self):
        row = {"title": "Notturno ", "year": "2021", "directors": ["Gianfranco Rosi "]}
        films = [("Notturno", "2020", "rosi"), ("Notturno", "2020", "other")]
        directors = {"rosi": ["Gianfranco Rosi"], "other": ["Someone Else"]}
        self.assertEqual(catalogs.same_film(row, films, directors.get), "rosi")
        self.assertIsNone(catalogs.same_film(dict(row, directors=[]), films, directors.get))

    def test_words_must_begin_the_title(self):
        row = {"title": "The Order", "year": "2024", "directors": ["Justin Kurzel"]}
        self.assertIsNone(catalogs.same_film(row, [("New Order", "2024", "x")], lambda item: ["Justin Kurzel"]))


class RefreshTests(unittest.TestCase):
    def test_single_refresh_stale_failure_restart_and_recovery(self):
        entered, release = Event(), Event()
        rows = [{"title": "Easy Rider", "year": 1969}]
        calls = []

        def fetch():
            calls.append(1)
            entered.set()
            if not release.wait(5):
                raise RuntimeError("test timeout")
            return list(rows)

        def wait_for(store):
            for _ in range(500):
                if not store.snapshot()["sources"]["criterion"]["refreshing"]:
                    return
                time.sleep(.01)
            self.fail("refresh did not finish")

        with TemporaryDirectory() as tmp, patch.dict(catalogs.SOURCES, {"criterion": fetch}, clear=True), \
                patch.dict(catalogs.MINIMUM, criterion=1):
            store = catalogs.CatalogStore(tmp, dict)
            store.start()
            self.assertTrue(entered.wait(2))
            for _ in range(5):
                self.assertTrue(store.snapshot()["sources"]["criterion"]["refreshing"])
            release.set()
            wait_for(store)
            self.assertEqual(len(calls), 1)
            path = Path(tmp) / "criterion.json"
            data = json.loads(path.read_text())
            data.update(updated=1, attempted=1)
            path.write_text(json.dumps(data))
            rows.clear()
            store = catalogs.CatalogStore(tmp, dict)
            store.start()
            wait_for(store)
            snapshot = catalogs.CatalogStore(tmp, dict).snapshot()
            self.assertEqual(snapshot["catalogs"]["criterion"][0]["title"], "Easy Rider")
            state = snapshot["sources"]["criterion"]
            self.assertEqual(state["updated"], 1)
            self.assertTrue(state["error"])
            self.assertFalse(state["refreshing"])
            rows.append({"title": "The Conversation", "year": 1974})
            store.refresh("criterion", manual=True)
            wait_for(store)
            self.assertFalse(store.snapshot()["sources"]["criterion"]["error"])
            self.assertEqual(len(calls), 3)

    def test_first_install_failure_is_distinct(self):
        with TemporaryDirectory() as tmp, patch.dict(catalogs.SOURCES, {"criterion": lambda: []}, clear=True):
            store = catalogs.CatalogStore(tmp, dict)
            store.update("criterion")
            result = store.snapshot()
            self.assertFalse(result["catalogs"]["criterion"])
            self.assertEqual(result["sources"]["criterion"]["updated"], 0)
            self.assertTrue(result["sources"]["criterion"]["error"])
