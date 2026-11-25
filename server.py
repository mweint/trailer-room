"""Trailer Room web server. Uses only the Python standard library."""

import argparse
import functools
import hashlib
import ipaddress
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from http.cookies import SimpleCookie, CookieError
import json
import mimetypes
import os
from pathlib import Path
import re
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
CINEMETA = "https://v3-cinemeta.strem.io"
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


def read_public(url):
    with urlopen(Request(url, headers={"User-Agent": "TrailerRoom/1.0"}), timeout=9) as r:
        return json.load(r)


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
    return {"imdb": imdb, "videos": videos, "art": meta.get("background") or "",
            "directors": meta.get("director") or [],
            "genres": meta.get("genres") or [], "runtime": meta.get("runtime") or "",
            "rating": meta.get("imdbRating") or row.get("rating")}


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
        if self.path == "/api/refresh/plex":
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
            return self.data(plex.include(collections.snapshot()))
        if path.startswith("/api/film/"):
            key = path.rsplit("/", 1)[1]
            if key in movies:
                row = movies[key]
                try:
                    return self.data(detail_cached(key, row.get("youtube"), row.get("slug"), int(time.time() // 21600)))
                except (OSError, ValueError):
                    return self.data({"error": "Trailer catalog unreachable."}, 503)
        if path in ("/", "/index.html", "/style.css", "/player.js", "/queue.js", "/fonts/dm-serif-text-latin.woff2",
                    "/logos/a24.svg", "/logos/criterion.png", "/logos/neon.svg", "/logos/janus.png",
                    "/logos/trailer-room.svg", "/logos/plex.svg", "/plex.js", "/crt.js"):
            asset = ROOT / "web" / (path.strip("/") or "index.html")
            return self.send(200, asset.read_bytes(), mimetypes.guess_type(asset)[0] or "application/octet-stream")
        self.data({"error": "Not found"}, 404)


collections = CatalogStore(Path(os.environ.get("TRAILER_ROOM_DATA", ROOT / "data")), register)
plex = PlexSource(collections.directory, register)


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
    plex.refresh()
    server.serve_forever()
