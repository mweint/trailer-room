import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

import server


PAGE = """<html><head>
<meta name="description" content="A secret agent&#039;s wife &amp; a &quot;used car salesman&quot;.">
<meta property="og:url" content="https://letterboxd.com/film/true-lies/">
<meta name="twitter:description" content="A secret agent's wife &amp; a used car…">
<meta name="twitter:label1" content="Directed by">
<meta name="twitter:data1" content="James Cameron">
<meta name="twitter:label2" content="Average rating">
<meta name="twitter:data2" content="3.60 out of 5">
</head></html>"""


class LetterboxdPageTests(unittest.TestCase):
    def test_reads_description_rating_and_url(self):
        self.assertEqual(server.letterboxd_page(PAGE), {
            "description": 'A secret agent\'s wife & a "used car salesman".',
            "rating": 3.6, "url": "https://letterboxd.com/film/true-lies/"})

    def test_rating_follows_its_label_not_its_slot(self):
        page = ('<meta name="twitter:label1" content="Average rating">'
                '<meta name="twitter:data1" content="4.12 out of 5">')
        self.assertEqual(server.letterboxd_page(page)["rating"], 4.12)

    def test_unrated_page(self):
        found = server.letterboxd_page('<meta name="description" content="Plot.">'
                                       '<meta name="twitter:label1" content="Directed by">')
        self.assertEqual((found["description"], found["rating"], found["url"]), ("Plot.", None, ""))


class WholeWordsTests(unittest.TestCase):
    def test_cases(self):
        cases = {
            "A complete sentence.": "A complete sentence.",
            "A man finds a myst...": "A man finds a…",
            "A man finds a mystery ...": "A man finds a mystery…",
            "The night before the heist, ...": "The night before the heist…",
            "Unbroken…": "Unbroken…",
            "...": "",
            "": "",
            None: "",
        }
        for text, expected in cases.items():
            self.assertEqual(server.whole_words(text), expected, text)


class GenreNameTests(unittest.TestCase):
    def test_one_vocabulary(self):
        self.assertEqual(server.genre_names(["Sci-Fi", "Science Fiction", "Drama"]), ["Science Fiction", "Drama"])
        self.assertEqual(server.genre_names(["Film-Noir", "Crime", "Biography"]), ["Noir", "Crime", "History"])
        self.assertEqual(server.genre_names(["Music", "Musical"]), ["Music", "Musical"])
        self.assertEqual(server.genre_names(["TV Movie", "Short", "Sport", None]), [])


class ExpiryTests(unittest.TestCase):
    def test_stale(self):
        now = 1_000_000_000
        self.assertFalse(server.stale(now - 86400, now))
        self.assertTrue(server.stale(now - server.RECHECK, now))
        self.assertTrue(server.stale(None, now))
        self.assertTrue(server.stale("yesterday", now))

    def test_genres_pending(self):
        now = 1_000_000_000
        cache = server.JsonCache(Path("missing-test-file.json"))
        cache.entries = {"found": {"genres": ["Drama"], "checked": now - 10 * server.RECHECK},
                         "empty-new": {"genres": [], "checked": now - 86400},
                         "empty-old": {"genres": [], "checked": now - server.RECHECK}}
        original = server.genre_cache
        server.genre_cache = cache
        try:
            self.assertFalse(server.genres_pending("found", now))
            self.assertFalse(server.genres_pending("empty-new", now))
            self.assertTrue(server.genres_pending("empty-old", now))
            self.assertTrue(server.genres_pending("unseen", now))
        finally:
            server.genre_cache = original


class JsonCacheTests(unittest.TestCase):
    def test_save_and_reload(self):
        with TemporaryDirectory() as folder:
            path = Path(folder) / "letterboxd.json"
            cache = server.JsonCache(path)
            cache.put("tt0111503", {"description": "Plot.", "rating": 3.6, "url": "", "fetched": 1})
            cache.save()
            self.assertFalse(path.with_suffix(".tmp").exists())
            self.assertEqual(json.loads(path.read_text("utf-8"))["tt0111503"]["rating"], 3.6)
            self.assertEqual(server.JsonCache(path).get("tt0111503")["description"], "Plot.")

    def test_corrupt_file_starts_empty(self):
        with TemporaryDirectory() as folder:
            path = Path(folder) / "genres.json"
            path.write_text("{not json", encoding="utf-8")
            self.assertEqual(server.JsonCache(path).items(), [])


if __name__ == "__main__":
    unittest.main()
