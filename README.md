# Trailer Room

A self-hosted trailer player for Criterion Collection, A24, NEON and Janus Films. Choose sources, press Play, and skip with **N**. **T** opens theater mode and **F** enters fullscreen. The player favors HD uploads and compares trailer likes. Filters, hidden films, skipped trailers and CRT preferences live in each browser.

## Run on a home server

```sh
docker compose up -d
```

Run the command above from the directory containing [compose.yaml](compose.yaml), or add the service from that file to an existing stack. Compose pulls `ghcr.io/mweint/trailer-room:latest` for Linux x86-64. The service stores its catalog JSON and refresh history in `/data/appdata/trailer-room` on the host. At startup it prepares that directory and runs the player as `PUID:PGID` (default `1000:1000`).

Open `http://YOUR-SERVER-IP:8765` using the server's LAN IP. The four lists load independently on first launch. Click Play to start streaming directly from YouTube or Vimeo. No API keys or Plex connection are required.

**Updates.** In Portainer, redeploy the stack with image re-pulling enabled. From the CLI, run `docker compose pull trailer-room` and then `docker compose up -d trailer-room`. The host directory persists across container replacements. If upgrading from the old named volume, the new directory fills on first launch. Player preferences stay in the browser at the same site address.

To run the same app directly on a PC, run `python -B server.py --open` from this repository. It uses the local `data/` directory and opens the player on localhost.

## Connect a Plex library

Open **Preferences → Connect Plex**, sign in with Plex, and choose a server. The library picker shows the actual names of the movie-type libraries shared with your account on that server. Choose one and click **Use this library**, even if only one library appears. Its films join the regular source toggles. Trailer Room skips known shorts and merges overlapping films with the curated sources.

The connection belongs to this installation. Everyone who can open it can see the selected titles. The server saves the selected library's metadata and Plex server credential in its appdata. It contacts Plex over HTTPS and plays public trailers through YouTube or Vimeo. No SSH access, media mount, or Compose changes are required.

A startup or visit checks for changes once a day. If Plex is unreachable, the source shows its last good list and offers a retry. In Preferences, **Change library** opens the picker. **Remove library** asks for confirmation and clears the imported list and server credential from this installation. The browser that connected the library can remove it directly. For older connections, other browsers, or after clearing cookies, Plex asks the owner to sign in.

Choosing a specific maximum U.S. rating switches **Include unrated films** off. Turn it on to include films marked unrated or missing a U.S. rating. Returning to **Any rating** keeps the switch where you left it. Each browser remembers the two visible choices.

## Catalog updates

Startup and page visits check the age of each list. A missing or 30-day-old list starts a background fetch. Simultaneous visits share one fetch per source. A failed request or unexpectedly small result preserves the last good list, including across restarts. Healthy sources show their film counts. After a failed refresh, the source row also shows its last successful update, failure time, reason and Retry button. A first-install failure is labeled separately. Automatic retries are eligible again after one hour, on the next startup or visit.

| Source | Where the installation gets its list |
| --- | --- |
| Criterion Collection | Films carrying the [Criterion film identifier on Wikidata](https://www.wikidata.org/wiki/Property:P9584). Coverage follows Wikidata and can lag the Criterion shop. |
| A24 | The paginated film feed behind the [A24 catalog](https://a24films.com/films). |
| NEON | The film records embedded in the [NEON catalog](https://www.neonrated.com/films/all). |
| Janus Films | The [Janus Films list](https://www.janusfilms.com/films/list). |

Matching Wikidata records supply optional film identifiers and U.S. certifications. Film details and trailer IDs are resolved on demand using Cinemeta, A24 and YouTube. Upload resolution and like counts depend on provider availability. The image and repository contain no downloaded movie lists, IMDb bulk datasets or viewing history.

## Optional configuration

Set values in Portainer's stack environment or a local, Git-ignored `.env` beside `compose.yaml`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `CATALOG_REFRESH_DAYS` | `30` | Days before a successful list becomes eligible for refresh. |
| `TRAILER_ROOM_PORT` | `8765` | Published port on the host. |
| `TRAILER_ROOM_HOSTS` | empty | Comma-separated hostnames for LAN DNS or a reverse proxy. Localhost and private IP addresses already work. |

This LAN service has no user authentication. Browser playback requires access to the video provider. A reload during a catalog outage continues to use the saved lists.
