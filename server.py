"""Trailer Room web server. Uses only the Python standard library."""

import argparse
from concurrent.futures import ThreadPoolExecutor
import functools
import hashlib
import html
import ipaddress
import logging
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from http.cookies import SimpleCookie, CookieError
import json
import mimetypes
import os
from pathlib import Path
import re
from threading import Lock, Thread
import time
import unicodedata
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlsplit
from urllib.request import Request, urlopen
import webbrowser
from catalogs import CatalogStore, SOURCES
from plex import PlexError, PlexSource
from trailer_selection import rank_trailers

ROOT = Path(__file__).resolve().parent
mimetypes.add_type("font/woff2", ".woff2")  # Not in every platform's table (Windows lacks it).
CINEMETA = "https://v3-cinemeta.strem.io"
RECHECK = 30 * 86400  # Ratings drift and missing films get added, but slowly.
LETTERBOXD_GAP = 2.0
GENRE_WORKERS = 5
YOUTUBE = re.compile(r"[A-Za-z0-9_-]{11}\Z")
IMDB = re.compile(r"tt\d{7,10}\Z")
movies = {}


def normal(title):
    return "".join(c for c in unicodedata.normalize("NFKD", title.casefold()) if c.isalnum())


def register(row):
    imdb = row.get("imdb") or ""
    alias = normal(row["title"]) + "/" + str(row.get("year") or "")
    key = imdb if IMDB.fullmatch(imdb) else "film-" + hashlib.sha256(alias.encode()).hexdigest()[:24]
    record = {**row, "key": key, "alias": alias}
    # Keep provider-specific fields from each catalog when two references coincide.
    movies[key] = {**movies.get(key, {}), **{k: v for k, v in record.items() if v}}
    return record


def read_public(url, headers=None):
    with urlopen(Request(url, headers={"User-Agent": "TrailerRoom/1.0", **(headers or {})}), timeout=9) as r:
        return json.load(r)


class JsonCache:
    """Per-film entries in one JSON file: loaded once, replaced atomically so a crash never leaves half a file."""

    def __init__(self, path):
        self.path = Path(path)
        self.lock = Lock()
        self.dirty = False
        try:
            entries = json.loads(self.path.read_text("utf-8"))
        except (OSError, ValueError):
            entries = {}
        self.entries = entries if isinstance(entries, dict) else {}

    def get(self, key):
        with self.lock:
            return self.entries.get(key)

    def put(self, key, value):
        with self.lock:
            self.entries[key] = value
            self.dirty = True

    def items(self):
        with self.lock:
            return list(self.entries.items())

    def save(self):
        with self.lock:
            if not self.dirty:
                return
            try:
                self.path.parent.mkdir(parents=True, exist_ok=True)
                temp = self.path.with_suffix(".tmp")
                temp.write_text(json.dumps(self.entries, ensure_ascii=False), encoding="utf-8")
                temp.replace(self.path)
                self.dirty = False
            except OSError as exc:
                logging.warning("%s write failed: %s", self.path.name, exc)


def stale(stamp, now, age=RECHECK):
    return not isinstance(stamp, (int, float)) or now - stamp >= age


def letterboxd_page(text):
    """Synopsis and average rating from the meta tags of a Letterboxd film page."""
    tags = {}
    for tag in re.findall(r"<meta\s[^>]*>", text):
        name = re.search(r'\s(?:name|property)="([^"]+)"', tag)
        content = re.search(r'\scontent="([^"]*)"', tag)
        if name and content:
            tags.setdefault(name[1], html.unescape(content[1]).strip())
    rating = None
    # The rating rides in a labelled twitter:dataN slot; match the label rather than trusting the slot number.
    for slot in "1234":
        if tags.get("twitter:label" + slot, "").casefold() == "average rating":
            value = re.match(r"(\d+(?:\.\d+)?) out of 5", tags.get("twitter:data" + slot, ""))
            rating = float(value[1]) if value else None
    return {"description": tags.get("description", ""), "rating": rating, "url": tags.get("og:url", "")}


def letterboxd_fetch(imdb):
    """One page fetch; None means a network failure, which is not cached."""
    request = Request("https://letterboxd.com/imdb/" + imdb + "/", headers={"User-Agent": "TrailerRoom/1.0"})
    try:
        with urlopen(request, timeout=9) as r:
            final = r.geturl()
            page = r.read().decode("utf-8", "replace")
    except HTTPError as err:
        return {"description": "", "rating": None, "url": ""} if err.code == 404 else None
    except (OSError, ValueError):
        return None
    # An unknown id answers 200 on /imdb/ itself; only a redirect to /film/ is a match.
    if "/film/" not in urlsplit(final).path:
        return {"description": "", "rating": None, "url": ""}
    found = letterboxd_page(page)
    return {**found, "url": found["url"] or final}


def letterboxd(imdb):
    """Cached Letterboxd details, fetched one film at a time and never faster than one page per LETTERBOXD_GAP."""
    if not IMDB.fullmatch(imdb or ""):
        return None
    entry = letterboxd_cache.get(imdb)
    if entry and not stale(entry.get("fetched"), time.time()):
        return entry
    with letterboxd_lock:
        # Another request may have fetched this film while this one waited.
        entry = letterboxd_cache.get(imdb)
        if entry and not stale(entry.get("fetched"), time.time()):
            return entry
        time.sleep(max(0.0, letterboxd_last[0] + LETTERBOXD_GAP - time.monotonic()))
        found = letterboxd_fetch(imdb)
        letterboxd_last[0] = time.monotonic()
        if found is None:
            return entry
        old = entry or {}
        # Refetches exist for the rating; a synopsis once found is kept.
        entry = {"description": found["description"] or old.get("description", ""), "rating": found["rating"],
                 "url": found["url"] or old.get("url", ""), "fetched": int(time.time())}
        letterboxd_cache.put(imdb, entry)
        letterboxd_cache.save()
        return entry


def whole_words(text):
    """Cinemeta cuts some descriptions mid-word and adds '...'; end them on a whole word instead."""
    text = (text or "").strip()
    if not text.endswith(("...", "…")):
        return text
    body = text.rstrip(".…")
    if not body.strip():
        return ""
    # A space before the dots means the last word is whole; otherwise it was cut and is dropped.
    if body[-1:].isspace() or " " not in body:
        body = body.rstrip()
    else:
        body = body.rsplit(" ", 1)[0]
    return body.rstrip(" ,;:-–—") + "…"


def find_imdb(row):
    if IMDB.fullmatch(row.get("imdb") or ""):
        return row["imdb"]
    catalog = read_public(CINEMETA + "/catalog/movie/top/search=" + quote(row["title"], safe="") + ".json")
    matches = [m for m in catalog.get("metas", []) if normal(m["name"]) == normal(row["title"])
               and str(m.get("releaseInfo", ""))[:4] == str(row.get("year"))]
    return matches[0]["id"] if len(matches) == 1 and IMDB.fullmatch(matches[0]["id"]) else ""


def add_video(videos, provider, value):
    if not isinstance(value, str):
        return
    if (provider == "youtube" and YOUTUBE.fullmatch(value)) or (provider == "vimeo" and re.fullmatch(r"\d{5,12}", value)):
        item = {"provider": provider, "id": value}
        if item not in videos:
            videos.append(item)


@functools.lru_cache(maxsize=2048)
def detail_cached(key, youtube, slug, period):
    row = movies[key]
    videos = []
    add_video(videos, "youtube", youtube)
    meta = {}
    imdb = row.get("imdb")
    outage = False
    try:
        imdb = find_imdb(row)
        if imdb:
            meta = read_public(CINEMETA + "/meta/movie/" + imdb + ".json").get("meta") or {}
    except HTTPError as err:
        outage = err.code != 404
    except (OSError, ValueError):
        outage = True
    if not outage:
        record_genres(key, meta.get("genres"))
    for entry in meta.get("trailers") or []:
        if str(entry.get("type", "")).lower() not in ("trailer", "teaser"):
            continue
        add_video(videos, "vimeo" if str(entry.get("site", "")).lower() == "vimeo" else "youtube", entry.get("source"))
    for entry in meta.get("trailerStreams") or []:
        add_video(videos, "youtube", entry.get("ytId"))
        add_video(videos, "vimeo", entry.get("vimeoId"))
    duration = re.match(r"(\d+)\s*min", str(meta.get("runtime") or ""), re.I)
    if duration and int(duration[1]) < 40:
        return {"imdb": imdb, "videos": []}
    if slug:
        try:
            official = read_public("https://api.a24films.com/api/web/v1/films/" + quote(slug, safe="") + "/")
            video = (official.get("primary_trailer") or {}).get("video") or {}
            add_video(videos, "youtube", video.get("youtube_id"))
            add_video(videos, "vimeo", video.get("vimeo_id"))
        except (OSError, ValueError):
            outage = True
    videos = rank_trailers(videos, row, meta, period)
    if outage and not videos:
        raise URLError("Trailer metadata is temporarily unavailable")
    boxd = letterboxd(imdb) or {}
    return {"imdb": imdb, "videos": videos, "art": meta.get("background") or "",
            "directors": meta.get("director") or [],
            "description": boxd.get("description") or whole_words(meta.get("description")),
            "genres": genre_names(meta.get("genres")), "runtime": meta.get("runtime") or "",
            "rating": meta.get("imdbRating") or row.get("rating"),
            "letterboxd": {"rating": boxd.get("rating"), "url": boxd.get("url") or ""}}


def record_genres(key, genres):
    genres = [g for g in genres or [] if isinstance(g, str) and g]
    genre_cache.put(key, {"genres": genres, "checked": int(time.time())})


def genres_pending(key, now):
    entry = genre_cache.get(key)
    # Found genres do not change; an empty answer may be a film Cinemeta adds later.
    return not isinstance(entry, dict) or (not entry.get("genres") and stale(entry.get("checked"), now))


# One genre vocabulary, based on the list Letterboxd uses (TMDB's), plus Musical and Noir.
# Cinemeta mixes IMDb names ("Sci-Fi") and TMDB names ("Science Fiction"); both map here.
# Names not listed (TV Movie, Short, Sport, Reality-TV, ...) are dropped: a film always has another genre too.
GENRES = {
    "Action": "Action", "Adventure": "Adventure", "Animation": "Animation", "Comedy": "Comedy",
    "Crime": "Crime", "Documentary": "Documentary", "Drama": "Drama", "Family": "Family",
    "Fantasy": "Fantasy", "History": "History", "Biography": "History", "Horror": "Horror",
    "Music": "Music", "Musical": "Musical", "Mystery": "Mystery", "Film-Noir": "Noir", "Film Noir": "Noir",
    "Romance": "Romance", "Sci-Fi": "Science Fiction", "Science Fiction": "Science Fiction",
    "Thriller": "Thriller", "War": "War", "Western": "Western",
}


def genre_names(genres):
    names = []
    for genre in genres or []:
        name = GENRES.get(genre)
        if name and name not in names:
            names.append(name)
    return names


def film_genres():
    return {key: genre_names(entry["genres"]) for key, entry in genre_cache.items()
            if key in movies and isinstance(entry, dict) and genre_names(entry.get("genres"))}


def genre_progress():
    now = time.time()
    keys = list(movies)
    return {"done": sum(not genres_pending(k, now) for k in keys), "total": len(keys)}


def fetch_genres(key):
    row = movies[key]
    try:
        imdb = row.get("imdb") if IMDB.fullmatch(row.get("imdb") or "") else find_imdb(row)
        meta = read_public(CINEMETA + "/meta/movie/" + imdb + ".json").get("meta") or {} if imdb else {}
        record_genres(key, meta.get("genres"))
        return True
    except HTTPError as err:
        if err.code == 404:
            record_genres(key, [])
            return True
        return False
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        return False


def genre_pass():
    """Fill in Cinemeta genres for every listed film, for the genre filter. Cinemeta is a cached public
    service built for apps, so a few requests at a time are fine; the first pass takes minutes."""
    failed = {}  # key -> retry time, so a film that keeps erroring cannot hold up the rest
    with ThreadPoolExecutor(GENRE_WORKERS) as pool:
        while True:
            now = time.time()
            pending = [k for k in list(movies) if failed.get(k, 0) <= now and genres_pending(k, now)]
            if not pending:
                genre_cache.save()
                time.sleep(60)
                continue
            for start in range(0, len(pending), 50):
                batch = [k for k in pending[start:start + 50] if genres_pending(k, time.time())]
                for key, ok in zip(batch, pool.map(fetch_genres, batch)):
                    if not ok:
                        failed[key] = time.time() + 3600
                genre_cache.save()


def allowed_host(header, port, lan):
    if header in (f"127.0.0.1:{port}", f"localhost:{port}"):
        return True
    if not lan:
        return False
    try:
        address = urlsplit("//" + header)
        if address.username is not None or address.path or address.query or address.fragment:
            return False
        host = address.hostname or ""
        hosts = os.getenv("TRAILER_ROOM_HOSTS", "").lower().split(",")
        if host == "localhost" or host in (h.strip() for h in hosts if h.strip()):
            return True
        return ipaddress.ip_address(host).is_private
    except ValueError:
        return False


class Handler(BaseHTTPRequestHandler):
    def send(self, code, body, content_type, cookie=None):
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        if cookie:
            self.send_header("Set-Cookie", cookie)
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
        self.end_headers()
        try:
            self.wfile.write(body)
        except (ConnectionError, OSError):
            pass

    def data(self, obj, code=200, cookie=None):
        self.send(code, json.dumps(obj).encode(), "application/json", cookie)

    def do_POST(self):
        host = self.headers.get("Host", "")
        if (not allowed_host(host, self.server.server_port, self.server.server_address[0] != "127.0.0.1")
                or self.headers.get("Content-Type") != "application/json"
                or self.headers.get("Origin") not in (None, "http://" + host, "https://" + host)):
            return self.data({"error": "Invalid refresh request."}, 403)
        # Plex libraries ("plex-<key>") refresh together, as they come from one server.
        if self.path == "/api/refresh/plex" or self.path.startswith("/api/refresh/plex-"):
            plex.refresh(manual=True)
            return self.data({"accepted": True}, 202)
        if self.path.startswith("/api/plex/"):
            origin = self.headers.get("Origin")
            if not origin:
                return self.data({"error": "Open Preferences to configure Plex."}, 403)
            action = self.path.removeprefix("/api/plex/")
            if action not in ("begin", "servers", "libraries", "connect", "disconnect"):
                return self.data({"error": "Not found"}, 404)
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= 2048:
                    raise ValueError()
                body = json.loads(self.rfile.read(length))
                if not isinstance(body, dict) or not all(isinstance(v, str) for v in body.values()):
                    raise ValueError()
            except (ValueError, UnicodeError):
                return self.data({"error": "Invalid Plex request."}, 400)
            try:
                cookies = SimpleCookie()
                try:
                    cookies.load(self.headers.get("Cookie", ""))
                except CookieError:
                    pass
                device = cookies.get("tr_plex_remove")
                result = plex.begin(origin) if action == "begin" else plex.action(action, body, device.value if device else "")
                cookie = None
                if "device_key" in result or (action == "disconnect" and not result):
                    key = result.pop("device_key", "")
                    age = 31536000 if key else 0
                    cookie = f"tr_plex_remove={key}; Max-Age={age}; Path=/api/plex/; HttpOnly; SameSite=Strict"
                    if origin.startswith("https://"):
                        cookie += "; Secure"
                return self.data(result, cookie=cookie)
            except PlexError as exc:
                return self.data({"error": str(exc)}, 400)
            except (OSError, ValueError, KeyError, TypeError):
                return self.data({"error": "Could not complete the Plex request. Check the connection and try again."}, 503)
        for key in SOURCES:
            if self.path == "/api/refresh/" + key:
                collections.refresh(key, manual=True)
                return self.data({"accepted": True}, 202)
        self.data({"error": "Not found"}, 404)

    def do_GET(self):
        port = self.server.server_port
        if not allowed_host(self.headers.get("Host", ""), port, self.server.server_address[0] != "127.0.0.1"):
            return self.data({"error": "Use the local player address."}, 403)
        path = urlsplit(self.path).path
        if path == "/api/collections":
            return self.data({**plex.include(collections.snapshot()), "genres": film_genres(),
                              "genreProgress": genre_progress()})
        if path.startswith("/api/film/"):
            key = path.rsplit("/", 1)[1]
            if key in movies:
                row = movies[key]
                try:
                    return self.data(detail_cached(key, row.get("youtube"), row.get("slug"), int(time.time() // 21600)))
                except (OSError, ValueError):
                    return self.data({"error": "Trailer catalog unreachable."}, 503)
        web = ROOT / "web"
        try:
            asset = (web / (path.strip("/") or "index.html")).resolve()
        except (OSError, ValueError):
            asset = ROOT
        if asset.is_relative_to(web) and asset.is_file():
            return self.send(200, asset.read_bytes(), mimetypes.guess_type(asset)[0] or "application/octet-stream")
        self.data({"error": "Not found"}, 404)


collections = CatalogStore(Path(os.environ.get("TRAILER_ROOM_DATA", ROOT / "data")), register)
plex = PlexSource(collections.directory, register)
letterboxd_cache = JsonCache(collections.directory / "letterboxd.json")
letterboxd_lock = Lock()
letterboxd_last = [0.0]  # monotonic time of the last Letterboxd request
genre_cache = JsonCache(collections.directory / "genres.json")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--open", action="store_true")
    args = parser.parse_args()
    bind = os.getenv("TRAILER_ROOM_BIND", "127.0.0.1")
    address = "http://127.0.0.1:8765/"
    if os.name == "nt":
        ThreadingHTTPServer.allow_reuse_address = False
    try:
        server = ThreadingHTTPServer((bind, 8765), Handler)
    except OSError:
        try:
            if args.open and "sources" in read_public(address + "api/collections"):
                webbrowser.open(address)
                raise SystemExit(0)
        except (OSError, ValueError, AttributeError):
            pass
        raise SystemExit("Local port 8765 is already in use.")
    print(f"Trailer Room listening on {bind}:8765", flush=True)
    if args.open:
        webbrowser.open(address)
    collections.start()
    Thread(target=genre_pass, daemon=True).start()
    plex.refresh()
    server.serve_forever()
