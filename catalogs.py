"""Build and cache provider lists on the installation that serves them."""

import html
import json
import logging
import os
from pathlib import Path
import re
from threading import Lock, Thread
import time
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


def download(url, timeout=25):
    request = Request(url, headers={"User-Agent": "TrailerRoom/1.0 (https://github.com/mweint/trailer-room)"})
    with urlopen(request, timeout=timeout) as response:
        return response.read().decode("utf-8")


def wikidata(selector):
    query = """SELECT ?film ?name (MIN(YEAR(?date)) AS ?year) (SAMPLE(?id) AS ?imdb)
               (SAMPLE(?ratingLabel) AS ?cert) WHERE {
      SELECTOR . ?film rdfs:label ?name; wdt:P577 ?date.
      FILTER(LANG(?name)="en") FILTER NOT EXISTS {?film wdt:P31 wd:Q24862}
      OPTIONAL {?film wdt:P345 ?id}
      OPTIONAL {?film wdt:P1657 ?rating. ?rating rdfs:label ?ratingLabel. FILTER(LANG(?ratingLabel)="en")}
    } GROUP BY ?film ?name""".replace("SELECTOR", selector)
    url = "https://query.wikidata.org/sparql?" + urlencode({"query": query, "format": "json"})
    bindings = json.loads(download(url, timeout=75))["results"]["bindings"]
    rows = []
    for binding in bindings:
        values = {k: v["value"] for k, v in binding.items()}
        rows.append({"title": values["name"], "year": values["year"], "imdb": values.get("imdb"),
                     "certification": values.get("cert")})
    return rows


YEAR_SLACK = 3


def nearest(candidates, year):
    """The one (year, item) candidate for a title whose year is nearest `year`, at most YEAR_SLACK away, or None.
    A distributor often lists its own release year, a year or more after the premiere that IMDb, Wikidata and
    Letterboxd record (NEON's Hell of a Summer: 2025 against 2023), so an exact year cannot be required.
    Two candidates equally near (a remake, a namesake) match neither."""
    try:
        year = int(year)
    except (TypeError, ValueError):
        return None
    by_gap = {}
    for candidate_year, item in candidates:
        try:
            gap = abs(int(str(candidate_year)[:4]) - year)
        except ValueError:
            continue
        if gap <= YEAR_SLACK:
            by_gap.setdefault(gap, []).append(item)
    closest = by_gap.get(min(by_gap)) if by_gap else []
    return closest[0] if len(closest) == 1 else None


def criterion():
    return wikidata("?film wdt:P9584 ?criterion")


def a24():
    base = "https://api.a24films.com/api/web/v1/films/"
    page = 1
    rows = []
    while True:
        data = json.loads(download(base + "?page=" + str(page)))
        for film in data["results"]:
            if film.get("title_type") == "film":
                rows.append({"title": film["display_name"], "year": film.get("year"), "slug": film["slug"],
                             "poster": (film.get("static_art") or {}).get("src")})
        if not data.get("next"):
            return rows
        if not data["results"] or page >= 100:
            raise ValueError("Unexpected A24 pagination")
        page += 1


def janus():
    page = download("https://www.janusfilms.com/films/list")
    rows = []
    for card in page.split('class="film-card-container"')[1:]:
        title = re.search(r'<h4 class="title">\s*<a[^>]*>(.*?)</a>', card, re.S)
        year = re.search(r'<div class="year [^"]*">\s*(\d{4})', card)
        image = re.search(r'data-layzr="(https://[^"]+)"', card)
        if title and year:
            rows.append({"title": html.unescape(re.sub("<[^>]+>", "", title[1])).strip(),
                         "year": year[1], "poster": html.unescape(image[1]) if image else None})
    return rows


def neon():
    page = download("https://www.neonrated.com/films/all")
    marker = '"films":[{'
    for chunk in re.findall(r'self\.__next_f\.push\((.*?)\)</script>', page, re.S):
        packet = json.loads(chunk)
        if len(packet) < 2 or not isinstance(packet[1], str) or marker not in packet[1]:
            continue
        data = packet[1]
        films = json.JSONDecoder().raw_decode(data, data.index(marker) + len('"films":'))[0]
        return [{"title": f["title"], "year": f.get("year"), "certification": f.get("rating"),
                 "poster": (f.get("featuredImage") or {}).get("small")}
                for f in films if not f.get("isBundle") and (f.get("directedBy") or f.get("productType") == "Film & Television")]
    raise ValueError("NEON film feed missing")


SOURCES = {"criterion": criterion, "a24": a24, "janus": janus, "neon": neon}
MINIMUM = {"criterion": 500, "a24": 80, "janus": 500, "neon": 60}
COMPANY = {"a24": "Q16248298", "janus": "Q6155948", "neon": "Q30603559"}


def enrich(key, rows, previous):
    if key not in COMPANY:
        return
    # Missing supplemental metadata must not take a distributor's working feed offline.
    candidates = list(previous)
    try:
        candidates += wikidata(f"?film (wdt:P750|wdt:P272) wd:{COMPANY[key]}")
    except (OSError, ValueError, KeyError) as exc:
        logging.warning("%s optional Wikidata metadata unavailable: %s", key, exc)
    by_title = {}
    for row in candidates:
        if row.get("imdb"):
            by_title.setdefault(row["title"].casefold(), {})[row["imdb"]] = row
    for row in rows:
        group = by_title.get(row["title"].casefold(), {})
        match = nearest([(c["year"], c) for c in group.values()], row["year"])
        if match:
            row.update(imdb=match["imdb"], certification=row.get("certification") or match.get("certification"))


class CatalogStore:
    def __init__(self, directory, register):
        self.directory = Path(directory)
        self.register = register
        self.lock = Lock()
        self.running = set()
        self.states = {}
        self.rows = {}
        self.interval = 86400 * max(1, int(os.getenv("CATALOG_REFRESH_DAYS") or "30"))
        for key in SOURCES:
            try:
                data = json.loads(self.path(key).read_text("utf-8"))
                rows = [register(row) for row in data["rows"]]
                self.states[key] = {field: data[field] for field in ("updated", "attempted", "error")}
            except (OSError, ValueError, KeyError, TypeError):
                rows = []
                self.states[key] = {"updated": 0, "attempted": 0, "error": ""}
            self.rows[key] = rows

    def path(self, key):
        return self.directory / (key + ".json")

    def start(self):
        for key in SOURCES:
            self.refresh(key)

    def refresh(self, key, manual=False):
        with self.lock:
            state = self.states[key]
            now = time.time()
            if key in self.running or (not manual and
                (now - state["updated"] < self.interval or now - state["attempted"] < 3600)):
                return
            self.running.add(key)
            Thread(target=self.update, args=(key,), daemon=True).start()

    def update(self, key):
        old = self.rows[key]
        updated = self.states[key]["updated"]
        attempted = int(time.time())
        try:
            unique = {}
            for row in SOURCES[key]():
                if row.get("title") and re.fullmatch(r"\d{4}", str(row.get("year", ""))):
                    identity = row.get("imdb") or (row["title"].casefold(), str(row["year"]))
                    unique[identity] = row
            if len(unique) < max(MINIMUM[key], len(old) * .7):
                raise ValueError("Unexpectedly small catalog")
            raw = list(unique.values())
            enrich(key, raw, old)
            state = {"updated": attempted, "attempted": attempted, "error": ""}
        except Exception as exc:
            logging.warning("%s refresh failed: %s", key, exc)
            reason = (f"Provider returned HTTP {exc.code}." if isinstance(exc, HTTPError) else
                      "Provider could not be reached." if isinstance(exc, OSError) else
                      "Film list format or size changed. Check the source endpoint.")
            state = {"updated": updated, "attempted": attempted, "error": reason}
            raw = old
        try:
            self.directory.mkdir(parents=True, exist_ok=True)
            path = self.path(key)
            temp = path.with_suffix(".tmp")
            temp.write_text(json.dumps({**state, "rows": raw}, ensure_ascii=False), encoding="utf-8")
            temp.replace(path)
            with self.lock:
                if not state["error"]:
                    self.rows[key] = [self.register(row) for row in raw]
                self.states[key] = state
        except OSError as exc:
            logging.warning("%s cache write failed: %s", key, exc)
            with self.lock:
                self.states[key] = {"updated": updated, "attempted": attempted, "error": "Cannot write the local cache."}
        finally:
            with self.lock:
                self.running.discard(key)

    def snapshot(self):
        self.start()
        with self.lock:
            return {"catalogs": self.rows.copy(),
                    "sources": {key: {**state, "refreshing": key in self.running}
                                for key, state in self.states.items()}}
