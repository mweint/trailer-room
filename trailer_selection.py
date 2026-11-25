"""Rank public trailer uploads using the video's formats and audience response."""

from concurrent.futures import ThreadPoolExecutor
from functools import lru_cache
import json
import re
import unicodedata
from urllib.parse import urlencode
from urllib.request import Request, urlopen


workers = ThreadPoolExecutor(max_workers=5)
VIDEO_ID = re.compile(r"[\w-]{11}", re.ASCII)
UNRELATED = re.compile(r"\b(?:concept|fan[ -]?(?:made|edit|trailer)|reaction|review|explained|parody|mashup|gameplay|AI generated|honest trailers?)\b", re.I)


def page(url):
    headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
               "Accept-Language": "en-US,en;q=0.9"}
    with urlopen(Request(url, headers=headers), timeout=6) as response:
        return response.read(5_000_000).decode("utf-8")


def embedded_json(html, name):
    marker = re.search(r"\b" + name + r"\s*=\s*", html)
    return json.JSONDecoder().raw_decode(html, marker.end())[0] if marker else {}


def number(value):
    return int(value) if str(value).isascii() and str(value).isdigit() else None


@lru_cache(maxsize=4096)
def video_metrics(provider, video_id, period):
    if provider == "vimeo":
        data = json.loads(page("https://vimeo.com/api/v2/video/" + video_id + ".json"))[0]
        return {"height": number(data.get("height")), "likes": number(data.get("stats_number_of_likes")),
                "views": number(data.get("stats_number_of_plays"))}
    data = embedded_json(page("https://www.youtube.com/watch?v=" + video_id + "&hl=en"), "ytInitialPlayerResponse")
    details = data.get("videoDetails", {})
    if details.get("videoId") != video_id:
        return {}
    media = data.get("streamingData", {})
    heights = []
    for fmt in media.get("adaptiveFormats", []) + media.get("formats", []):
        label = re.match(r"(\d+)p", fmt.get("qualityLabel", ""))
        value = int(label[1]) if label else number(fmt.get("height"))
        if value:
            heights.append(value)
    micro = data.get("microformat", {}).get("playerMicroformatRenderer", {})
    return {"height": max(heights, default=None), "likes": number(micro.get("likeCount")),
            "views": number(details.get("viewCount"))}


def words(value):
    value = "".join(c for c in unicodedata.normalize("NFKD", value.casefold()) if not unicodedata.combining(c))
    return " ".join(re.findall(r"\w+", value))


def search_trailers(title, year, credits):
    if not title or not year:
        return []
    query = urlencode({"search_query": f"{title} {year} official movie trailer", "hl": "en"})
    data = embedded_json(page("https://www.youtube.com/results?" + query), "ytInitialData")
    sections = (data.get("contents", {}).get("twoColumnSearchResultsRenderer", {}).get("primaryContents", {})
                .get("sectionListRenderer", {}).get("contents", []))
    matches = []
    for section in sections:
        for item in section.get("itemSectionRenderer", {}).get("contents", []):
            hit = item.get("videoRenderer", {})
            name = "".join(r.get("text", "") for r in hit.get("title", {}).get("runs", []))
            vid = hit.get("videoId", "")
            if not VIDEO_ID.fullmatch(vid) or UNRELATED.search(name) or not re.search(r"\b(?:trailer|teaser)\b", name, re.I):
                continue
            # Require the film title in the leading title segment, plus year or a matching credit.
            lead = re.split(r"\b(?:official|original|theatrical|restoration|teaser|trailer|HD|4K|remastered)\b|[|]|\s[-–—]\s", name, maxsplit=1, flags=re.I)[0]
            lead = re.sub(r"[\[(]?\b(?:19|20)\d\d\b[\])]?", "", lead)
            if words(lead) != words(title):
                continue
            years = re.findall(r"\b(?:19|20)\d\d\b", name)
            if str(year) not in years and (years or not any(words(c) in words(name) for c in credits if len(words(c)) > 4)):
                continue
            duration = hit.get("lengthText", {}).get("simpleText", "").split(":")
            if len(duration) != 2 or not all(v.isdigit() for v in duration) or not 15 <= int(duration[0])*60+int(duration[1]) <= 420:
                continue
            if vid not in matches:
                matches.append(vid)
    return matches


def rank(video):
    height = video.get("height") or 0
    # Once an upload clears 1080p, likes decide between HD and UHD versions.
    tier = 3 if height >= 1080 else 2 if height >= 720 else 1 if height else 0
    return tier, video.get("likes") or 0, height, video.get("views") or 0


def rank_trailers(known, row, meta, period):
    candidates = [dict(v) for v in known]
    jobs = {}

    def inspect(video):
        key = (video["provider"], video["id"])
        jobs[key] = workers.submit(video_metrics, *key, period)

    for video in candidates:
        inspect(video)
    credits = (meta.get("director") or []) + (meta.get("cast") or [])[:4]
    try:
        extra = search_trailers(row["title"], row.get("year"), credits)
    except (OSError, ValueError, KeyError, TypeError):
        extra = []
    additions = 0
    for vid in extra:
        if ("youtube", vid) not in jobs:
            video = {"provider": "youtube", "id": vid}
            candidates.append(video)
            inspect(video)
            additions += 1
            if additions == 3:
                break
    for video in candidates:
        try:
            video.update(jobs[video["provider"], video["id"]].result())
        except (OSError, ValueError, KeyError, TypeError, IndexError):
            pass
    return sorted(candidates, key=rank, reverse=True)
