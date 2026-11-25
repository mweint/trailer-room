# Trailer Room

A self-hosted trailer player for Criterion Collection, A24, NEON and Janus Films. Choose sources, press Play, and skip with **N**. **T** opens theater mode and **F** enters fullscreen. The player favors HD uploads and compares trailer likes. Filters, hidden films, skipped trailers and CRT preferences live in each browser.

## Run on a home server

```sh
git clone https://github.com/mweint/trailer-room.git
cd trailer-room
docker compose up -d --build
```

Open `http://YOUR-SERVER-IP:8765` using the server's LAN IP. The four lists load independently on first launch. Playback starts when you click Play. YouTube and Vimeo stream directly to the viewer. The container runs one Python service with standard-library dependencies, fetches metadata and caches catalog JSON in the named `catalogs` volume. It needs outbound HTTPS. No API keys or Plex connection are required.

**Portainer (Docker Standalone)**. Under **Stacks → Add stack → Repository**, use `https://github.com/mweint/trailer-room`, reference `refs/heads/main`, and Compose path `compose.yaml`. Deploy the stack. To update a CLI installation, run `git pull --ff-only` and then `docker compose up -d --build`. Keep the named volume to preserve catalog history.

## Catalog updates

Startup and page visits check the age of each list. A missing or 30-day-old list starts a background fetch. Simultaneous visits share one fetch per source. A failed request or unexpectedly small result preserves the last good list, including across restarts. The source row shows its last successful update, failure time, reason and Retry button. A first-install failure is labeled separately. Automatic retries are eligible again after one hour, on the next startup or visit.

| Source | Where the installation gets its list |
| --- | --- |
| Criterion Collection | Films carrying the [Criterion film identifier on Wikidata](https://www.wikidata.org/wiki/Property:P9584). Coverage follows Wikidata and can lag the Criterion shop. |
| A24 | The paginated film feed behind the [A24 catalog](https://a24films.com/films). |
| NEON | The film records embedded in the [NEON catalog](https://www.neonrated.com/films/all). |
| Janus Films | The [Janus Films list](https://www.janusfilms.com/films/list). |

Matching Wikidata records supply optional film identifiers and U.S. certifications. Unknown certifications are excluded when a rating limit is active. Film details and trailer IDs are resolved on demand using Cinemeta, A24 and YouTube. Upload resolution and like counts depend on provider availability. The image and repository contain no downloaded movie lists, IMDb bulk datasets or viewing history.

## Optional configuration

Set values in Portainer's stack environment or a local, Git-ignored `.env` beside `compose.yaml`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `CATALOG_REFRESH_DAYS` | `30` | Days before a successful list becomes eligible for refresh. |
| `TRAILER_ROOM_PORT` | `8765` | Published port on the host. |
| `TRAILER_ROOM_HOSTS` | empty | Comma-separated hostnames for LAN DNS or a reverse proxy. Localhost and private IP addresses already work. |

This LAN service has no user authentication. Browser playback requires access to the video provider. A reload during a catalog outage continues to use the saved lists.
