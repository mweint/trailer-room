"""Optional installation-wide Plex film sources: one Plex server and the film libraries chosen on it, each its own
source ("plex-<library key>"), each switched on or off where it is listed. Only discovery-issued server tokens persist."""

import hashlib
import json
import os
from pathlib import Path
import re
import secrets
from tempfile import NamedTemporaryFile
from threading import Lock, Thread
import time
from urllib.parse import urlencode, urlsplit
from urllib.request import build_opener, HTTPRedirectHandler, Request
from uuid import uuid4


class PlexError(Exception):
    pass


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def request(url, client, token=None, method="GET"):
    headers = {"Accept": "application/json", "X-Plex-Product": "Trailer Room",
               "X-Plex-Client-Identifier": client}
    if token:
        headers["X-Plex-Token"] = token
    req = Request(url, headers=headers, method=method)
    with build_opener(NoRedirect()).open(req, timeout=12) as response:
        return json.load(response)


def discover(client, token):
    resources = request("https://clients.plex.tv/api/v2/resources?includeHttps=1&includeRelay=1", client, token)
    servers = {}
    for item in resources:
        if "server" not in item.get("provides", "").split(",") or not item.get("accessToken"):
            continue
        urls = []
        for conn in sorted(item.get("connections", []), key=lambda c: (bool(c.get("relay")), not c.get("local"))):
            uri = conn.get("uri") or ""
            address = urlsplit(uri)
            if (address.scheme == "https" and address.hostname and not address.username and
                    not address.password and address.path in ("", "/") and not address.query and not address.fragment):
                urls.append(uri.rstrip("/"))
        if urls:
            servers[item["clientIdentifier"]] = {"name": item["name"], "urls": urls,
                                                  "client": client, "token": item["accessToken"]}
    return servers


def sections(server):
    for url in server["urls"]:
        try:
            listing = request(url + "/library/sections", server["client"], server["token"])["MediaContainer"]
            libraries = {str(s["key"]): {"name": s["title"], "uuid": s.get("uuid", "")}
                         for s in listing.get("Directory", []) if s.get("type") == "movie" and str(s["key"]).isdigit()}
            return url, libraries
        except (OSError, ValueError, KeyError):
            continue
    raise PlexError("Couldn’t reach the Plex server. Check its connection and try again.")


def film_rows(server, key, library):
    url, libraries = sections(server)
    if key not in libraries or (library["uuid"] and libraries[key]["uuid"] != library["uuid"]):
        raise PlexError("This library is no longer available. Choose your libraries again under Programming.")
    rows = {}
    offset = 0
    while True:
        query = urlencode({"type": 1, "includeGuids": 1, "X-Plex-Container-Start": offset,
                           "X-Plex-Container-Size": 300})
        page = request(f"{url}/library/sections/{key}/all?{query}", server["client"], server["token"])["MediaContainer"]
        entries = page.get("Metadata", [])
        count = len(entries)
        if int(page.get("offset", offset)) != offset or int(page["size"]) != count:
            raise PlexError("Plex returned an incomplete library page. Try updating again.")
        for film in entries:
            if film.get("type") != "movie" or not film.get("title"):
                continue
            if 0 < int(film.get("duration") or 0) < 40 * 60000 or any(
                    g.get("tag", "").casefold() in ("short", "short film") for g in film.get("Genre", [])):
                continue
            ids = dict(g["id"].split("://", 1) for g in film.get("Guid", []) if "://" in g.get("id", ""))
            imdb = ids.get("imdb", "")
            rating = (film.get("contentRating") or "").upper().removeprefix("US/")
            if rating in ("NR", "UR", "NOT RATED", "UNRATED"):
                rating = "Unrated"
            row = {"title": film["title"], "year": film.get("year"), "tmdb": ids.get("tmdb"),
                   "imdb": imdb if re.fullmatch(r"tt\d{7,10}", imdb) else None, "certification": rating}
            rows[row["imdb"] or (row["title"], row["year"])] = row
        offset += count
        if "totalSize" in page:
            if offset >= int(page["totalSize"]):
                break
            if not count:
                raise PlexError("The library import stopped early. Try updating again.")
        elif count < 300:
            break
    return libraries[key], list(rows.values())


def choices(mapping):
    return sorted(({"id": key, "name": item["name"]} for key, item in mapping.items()),
                  key=lambda item: item["name"].casefold())


def as_libraries(data):
    """Saved connections from before several libraries were possible hold one library at the top level."""
    if data and "libraries" not in data and "key" in data:
        data = dict(data)
        data["libraries"] = [{field: data.pop(field) for field in ("key", "library", "rows", "updated", "attempted", "error")}]
    return data


class PlexSource:
    def __init__(self, directory, register):
        self.path = Path(directory) / "plex-library.json"
        self.register = register
        self.lock = Lock()
        self.flows = {}
        self.running = None
        try:
            self.saved = as_libraries(json.loads(self.path.read_text("utf-8")))
        except FileNotFoundError:
            self.saved = None
        self.rows = self.registered(self.saved)

    def registered(self, data):
        return {item["key"]: [self.register(row) for row in item["rows"]] for item in data["libraries"]} if data else {}

    def write(self, data):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = NamedTemporaryFile(dir=self.path.parent, delete=False, mode="w", encoding="utf-8")
        try:
            with tmp:
                json.dump(data, tmp)
            os.replace(tmp.name, self.path)
        finally:
            Path(tmp.name).unlink(missing_ok=True)
        self.saved = data

    def begin(self, origin):
        with self.lock:
            client = self.saved["server"]["client"] if self.saved else str(uuid4())
        pin = request("https://plex.tv/api/v2/pins?strong=true", client, method="POST")
        ticket = secrets.token_urlsafe(32)
        now = time.monotonic()
        with self.lock:
            self.flows = {k: f for k, f in self.flows.items() if f["until"] > now}
            self.flows[ticket] = {"client": client, "pin": pin["id"], "until": now + min(1800, int(pin["expiresIn"])),
                                  "lock": Lock()}
        params = {"clientID": client, "code": pin["code"], "context[device][product]": "Trailer Room",
                  "forwardUrl": origin + "/#plex-setup"}
        return {"flow": ticket, "url": "https://app.plex.tv/auth#?" + urlencode(params)}

    def connection_id(self):
        data = self.saved
        return data.get("connection") or hashlib.sha256(
            (data["server"]["client"] + "/" + data["libraries"][0]["key"]).encode()).hexdigest()

    def remove(self, expected):
        # Caller holds self.lock. Invalidate pending imports and refreshes as well.
        if self.saved and expected and expected != self.connection_id():
            raise PlexError("The Plex connection changed. Reload before removing it.")
        self.path.unlink(missing_ok=True)
        self.saved, self.rows, self.running = None, {}, None
        self.flows.clear()

    def owns(self, device_key):
        # Caller holds self.lock. The browser that connected Plex keeps a key whose hash is saved.
        digest = hashlib.sha256(device_key.encode()).hexdigest()
        return bool(device_key) and secrets.compare_digest(digest, self.saved.get("device_hash", ""))

    def import_chosen(self, server, body, offered):
        """The libraries named in body["library"] (comma-separated keys from `offered`), imported now."""
        keys = list(dict.fromkeys(k for k in body.get("library", "").split(",") if k))
        if not keys or any(key not in offered for key in keys):
            raise PlexError("Choose at least one library from the list.")
        now = int(time.time())
        imported = []
        for key in keys:
            library, rows = film_rows(server, key, offered[key])
            imported.append({"key": key, "library": library, "rows": rows, "updated": now, "attempted": now,
                             "error": ""})
        return imported

    def manage(self, action, body, device_key):
        """Change the connected server's libraries from the browser that connected it, without a new sign-in.
        "libraries" lists the server's film libraries; "connect" saves a new choice. Other browsers sign in."""
        with self.lock:
            data = self.saved
            if not data or not self.owns(device_key):
                return {"signInRequired": True}
        _, offered = sections(data["server"])
        if action == "libraries":
            return {"libraries": choices(offered)}
        imported = self.import_chosen(data["server"], body, offered)
        with self.lock:
            if self.saved is not data:
                raise PlexError("The Plex connection changed. Start again.")
            self.write(dict(data, libraries=imported))
            self.rows = self.registered(self.saved)
            self.running = None
        return {}

    def action(self, action, body, device_key=""):
        if action in ("libraries", "connect") and not body.get("flow"):
            return self.manage(action, body, device_key)
        if action == "disconnect" and not body.get("flow"):
            with self.lock:
                if not self.saved:
                    return {}
                if not self.owns(device_key):
                    return {"signInRequired": True}
                self.remove(body.get("connection"))
                return {}
        ticket = body.get("flow")
        with self.lock:
            flow = self.flows.get(ticket)
        if not flow or flow["until"] <= time.monotonic():
            raise PlexError("Plex sign-in expired. Start again.")
        with flow["lock"]:
            if action in ("servers", "disconnect") and "owner" not in flow:
                client = flow["client"]
                token = request(f"https://plex.tv/api/v2/pins/{flow['pin']}", client).get("authToken")
                if not token:
                    raise PlexError("Plex sign-in wasn’t completed. Start again.")
                owner = str(request("https://plex.tv/api/v2/user", client, token)["id"])
                with self.lock:
                    self.check_owner(owner)
                if action == "servers":
                    flow["servers"] = discover(client, token)
                flow["owner"] = owner
            if "owner" not in flow:
                raise PlexError("Sign in to Plex first.")
            if action == "servers":
                return {"servers": choices(flow["servers"])}
            if action == "disconnect":
                with self.lock:
                    self.check_owner(flow["owner"])
                    if self.flows.get(ticket) is not flow:
                        raise PlexError("The connection changed. Start again.")
                    self.remove(body.get("connection"))
                return {}
            server = flow["servers"].get(body.get("server"))
            if not server:
                raise PlexError("Choose a Plex server from the list.")
            if action == "libraries":
                _, libraries = sections(server)
                flow.setdefault("libraries", {})[body["server"]] = libraries
                return {"libraries": choices(libraries)}
            if action != "connect":
                raise PlexError("Unknown Plex action.")
            imported = self.import_chosen(server, body, flow.get("libraries", {}).get(body["server"], {}))
            with self.lock:
                self.check_owner(flow["owner"])
                if self.flows.get(ticket) is not flow:
                    raise PlexError("The connection changed. Start again.")
                device_key = secrets.token_urlsafe(32)
                self.write({"owner": flow["owner"], "server": server, "connection": uuid4().hex,
                            "device_hash": hashlib.sha256(device_key.encode()).hexdigest(), "libraries": imported})
                self.rows = self.registered(self.saved)
                self.running = None
                self.flows.clear()
            return {"device_key": device_key}

    def check_owner(self, owner):
        if self.saved and self.saved["owner"] != owner:
            raise PlexError("Sign in with the Plex account that connected this installation.")

    def refresh(self, manual=False):
        with self.lock:
            data = self.saved
            if not data or self.running or (not manual and all(
                    time.time() - item["updated"] < 86400 or time.time() - item["attempted"] < 3600
                    for item in data["libraries"])):
                return
            self.running = data
            Thread(target=self.update, args=(data,), daemon=True).start()

    def update(self, data):
        """Re-import the chosen libraries. A library that fails keeps its last good list and shows the error."""
        now = int(time.time())
        libraries = []
        for item in data["libraries"]:
            result = dict(item, attempted=now)
            try:
                library, rows = film_rows(data["server"], item["key"], item["library"])
                result.update(library=library, rows=rows, updated=now, error="")
            except (PlexError, OSError, ValueError, TypeError, KeyError) as exc:
                result["error"] = str(exc) if isinstance(exc, PlexError) else "Could not update the Plex library."
            libraries.append(result)
        with self.lock:
            if self.running is not data:
                return
            result = dict(data, libraries=libraries)
            try:
                self.write(result)
                # A library that failed keeps its last good rows.
                self.rows = {item["key"]: (self.rows.get(item["key"], []) if item["error"] else
                                           [self.register(row) for row in item["rows"]]) for item in libraries}
            except OSError:
                self.saved = dict(data, libraries=[dict(item, attempted=now, error="Cannot write the local cache.")
                                                   for item in data["libraries"]])
            finally:
                self.running = None

    def include(self, snapshot):
        self.refresh()
        with self.lock:
            if self.saved:
                snapshot["plex"] = {"server": self.saved["server"]["name"], "connection": self.connection_id(),
                                    "libraries": ["plex-" + item["key"] for item in self.saved["libraries"]]}
                for item in self.saved["libraries"]:
                    source = "plex-" + item["key"]
                    snapshot["catalogs"][source] = self.rows.get(item["key"], [])
                    snapshot["sources"][source] = {k: item[k] for k in ("updated", "attempted", "error")}
                    snapshot["sources"][source].update(name=item["library"]["name"], refreshing=self.running is not None)
        return snapshot
