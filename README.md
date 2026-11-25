# Trailer Room

A self-hosted trailer player for films from Criterion, A24, NEON, Janus Films and, optionally, your Plex library. Press Play and it runs trailers back to back. **N** skips, **T** is theater mode, **F** is fullscreen.

## Run

```yaml
services:
  trailer-room:
    image: ghcr.io/mweint/trailer-room:latest
    ports:
      - "8765:8765"
    volumes:
      - ./trailer-room:/data
    restart: unless-stopped
```

Then open `http://<server-ip>:8765`. No accounts or API keys are needed. To update, run `docker compose pull && docker compose up -d`.

## Options

| Variable | Default | Purpose |
| --- | --- | --- |
| `PUID`, `PGID` | `1000` | User and group that own `/data` |
| `TRAILER_ROOM_HOSTS` | none | Extra hostnames to allow, for a reverse proxy or LAN DNS name |
| `CATALOG_REFRESH_DAYS` | `30` | Days between film list refreshes |

## Plex

Open **Programming → Connect Plex**, sign in, and pick a library. Its films join the other sources. Anyone who can open Trailer Room can see those titles.

## Notes

- There is no login; it is meant for a home network.
- **Film lists:** Wikidata (Criterion) and the A24, NEON and Janus Films websites.
- **Trailers:** YouTube and Vimeo.
- **Descriptions and ratings:** Letterboxd.
- **Genres:** Cinemeta.
- Everything is fetched gently and cached in `/data`.
- To run without Docker: `python -B server.py --open`.
