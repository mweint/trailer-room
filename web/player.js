import {SOURCES, US_RATINGS, mergeSources, matches, withinRating} from "./queue.js";

const $ = id => document.getElementById(id);
const STORE = "trailer-room.v1";
let saved = {};
try { saved = JSON.parse(localStorage.getItem(STORE)) || {}; } catch {}
const prefs = {enabled: {criterion: true, a24: true, neon: true, janus: true, ...saved.enabled},
  maxRating: US_RATINGS.includes(saved.maxRating) ? saved.maxRating : "",
  hidden: saved.hidden || [], skipped: saved.skipped || [], crt: !!saved.crt, wide: !!saved.wide,
  volume: saved.volume ?? null, muted: !!saved.muted};
const catalogs = {};
const scores = new Map(), details = new Map(), unavailable = new Set(), broken = new Set();
const seenFilms = new Set(), seenVideos = new Set();
let films = [], queue = [], current, info, clip, player, generation = 0, pendingTimer;
let idleYouTube = null;
let playing = false, started = false, loading = false, failures = 0;
let idleTimer, adjustingControl = false, keyboardControl = false;
let captionsOn = false;
let lastPlayed = "", retrying = false;
const loaded = new Set();
let sourceStatus = {};
const sourceNames = film => film.sources.map(s => SOURCES[s].short || SOURCES[s].name).join(" / ");
const videoKey = v => v.provider + "/" + v.id;
const save = () => {
  try { localStorage.setItem(STORE, JSON.stringify(prefs)); }
  catch { setNotice("Browser storage is unavailable. Your preferences will last for this visit."); }
};
const el = (tag, cls, content) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (content !== undefined) node.textContent = content;
  return node;
};
function setNotice(message = "") { $("status").textContent = message; }
async function json(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error("Service unavailable");
  return r.json();
}
function detail(film) {
  if (!details.has(film.key)) {
    details.set(film.key, json("/api/film/" + encodeURIComponent(film.key)).catch(e => { details.delete(film.key); throw e; }));
  }
  return details.get(film.key);
}
function enabled(film) { return film.sources.some(s => prefs.enabled[s]) && withinRating(film, prefs.maxRating); }
function hidden(film) { return prefs.hidden.some(h => h.keys.some(key => film.keys.includes(key))); }
function playableClips(data) {
  return data.videos.filter(v => !broken.has(videoKey(v)) && !seenVideos.has(videoKey(v)) &&
    !prefs.skipped.some(s => s.video === videoKey(v)));
}
function rebuild(paint = true) {
  const eligible = films.filter(f => enabled(f) && !hidden(f) && !matches(f, unavailable));
  for (const film of eligible) if (!scores.has(film.id)) scores.set(film.id, Math.random());
  queue = eligible.filter(f => !matches(f, seenFilms) && f.id !== current?.id).sort((a,b) => scores.get(a.id) - scores.get(b.id));
  if (paint) renderQueue();
  return eligible;
}
function renderQueue() {
  const pending = !queue.length && Object.keys(SOURCES).some(s => prefs.enabled[s] && !loaded.has(s));
  $("queue").closest(".lineup").setAttribute("aria-busy", String(pending));
  $("queue").replaceChildren();
  $("remaining").textContent = queue.length ? queue.length.toLocaleString() + " queued" : "";
  for (const film of queue.slice(0, 12)) {
    const button = el("button"), li = el("li"), text = el("span");
    const fallback = el("span", "poster", film.title[0]);
    fallback.setAttribute("aria-hidden", "true");
    if (film.imdb || film.poster) {
      const img = el("img"); img.alt = ""; img.loading = "lazy";
      img.src = film.poster || "https://images.metahub.space/poster/small/" + film.imdb + "/img";
      img.onerror = () => img.replaceWith(fallback); button.append(img);
    } else button.append(fallback);
    text.append(el("span", "queue-title", film.title), el("span", "queue-sub", film.year));
    button.append(text); button.onclick = () => skipTo(film); li.append(button); $("queue").append(li);
  }
  $("queueEmpty").textContent = queue.length || pending ? "" :
    Object.values(prefs.enabled).some(Boolean) ? "No more films in this queue." : "Select a film source to build your queue.";
  fitQueuePreview();
}
function fitQueuePreview() {
  const list = $("queue");
  const preview = list.parentElement;
  const besidePlayer = matchMedia("(width > 54rem)").matches && !layout.classList.contains("theater-mode");
  let slots = 4;
  if (besidePlayer) {
    const aside = list.closest("aside");
    const below = aside.querySelector(".sources").getBoundingClientRect().height +
      parseFloat(getComputedStyle(aside).rowGap) + parseFloat(getComputedStyle(layout).paddingBottom);
    const available = innerHeight - (preview.getBoundingClientRect().top + scrollY) - below;
    const rowHeight = parseFloat(getComputedStyle(preview).minHeight) / 4;
    slots = Math.max(4, Math.min(12, Math.floor(available / rowHeight)));
  }
  preview.style.setProperty("--queue-rows", slots);
  const extra = Array.from(list.children).slice(4);
  extra.forEach((row, i) => { row.hidden = i + 4 >= slots; });
  // Wrapped titles can consume more than one slot.
  const limit = list.getBoundingClientRect().top + preview.clientHeight;
  const overflow = extra.filter(row => !row.hidden && row.getBoundingClientRect().bottom > limit + .5);
  for (const row of overflow) row.hidden = true;
}
function renderSources() {
  const focused = $("sources").contains(document.activeElement) ? document.activeElement.dataset.source : null;
  $("sources").replaceChildren();
  for (const [key, {name, logo: file}] of Object.entries(SOURCES)) {
    const label = el("label", "source"), input = el("input"), text = el("span","source-details");
    const total = films.filter(f => f.sources.includes(key) && withinRating(f, prefs.maxRating)).length;
    const count = loaded.has(key) ? total.toLocaleString() + (total === 1 ? " film" : " films") : "Loading…";
    text.append(el("span", "source-name", name), el("span", "count", count));
    input.type = "checkbox"; input.checked = !!prefs.enabled[key]; input.dataset.source = key; input.setAttribute("aria-label", name);
    input.onchange = () => { prefs.enabled[key] = input.checked; save(); sourcesChanged(); };
    const logo = el("img", "source-logo " + key);
    logo.alt = ""; logo.src = "/logos/" + file;
    label.append(logo,text,input,el("span","switch")); $("sources").append(label);
    const state = sourceStatus[key];
    if (state) {
      const date = stamp => new Date(stamp * 1000).toLocaleString(undefined, {dateStyle:"medium", timeStyle:"short"});
      const note = el("div", "source-update");
      if (state.error) {
        note.classList.add("source-issue");
        note.append(document.createTextNode((state.updated ? "Stale list from " + date(state.updated) : "No saved list") +
          ". Failed " + date(state.attempted) + ": " + state.error + " "));
        const retry = el("button", "", state.refreshing ? "Retrying?" : "Retry");
        retry.disabled = state.refreshing;
        retry.onclick = async () => {
          retry.disabled = true;
          try {
            const result = await fetch("/api/refresh/" + key, {method:"POST", headers:{"Content-Type":"application/json"}});
            if (!result.ok) throw Error();
            await syncCollections();
          } catch { retry.disabled = false; setNotice("Could not contact Trailer Room. Try again."); }
        };
        note.append(retry);
      } else {
        note.textContent = state.refreshing ? (state.updated ? "Updating saved list?" : "Fetching first list?") :
          state.updated ? "Updated " + date(state.updated) : "Waiting for first update";
      }
      $("sources").append(note);
    }
    if (focused === key) input.focus({preventScroll:true});
  }
}
function sourcesChanged() {
  films = mergeSources(catalogs);
  const replacement = films.find(f => current && f.keys.some(k => current.keys.includes(k)));
  if (replacement) current = {...replacement, keys: [...new Set([...current.keys, ...replacement.keys])]};
  rebuild(); renderSources();
  if (!current || !enabled(current) || hidden(current)) advance();
  else renderFilm();
}
function renderFilm() {
  if (!current || !clip) return;
  const imdb = info?.imdb || current.imdb;
  const directPath = /^tt\d+$/.test(imdb) ? "imdb/" + imdb :
    /^\d+$/.test(current.tmdb) ? "tmdb/" + current.tmdb : "";
  const query = [current.title, current.year && "year:" + current.year].filter(Boolean).join(" ");
  const href = "https://letterboxd.com/" + (directPath || "search/films/" + encodeURIComponent(query) + "/");
  for (const id of ["title", "filmTitle"]) {
    const heading = $(id);
    const link = heading.firstElementChild || el("a");
    if (link.href !== href || link.textContent !== current.title) {
      link.href = href; link.textContent = current.title;
      link.target = "_blank"; link.rel = "noopener noreferrer";
      link.title = directPath ? "View on Letterboxd (new tab)" : "Search Letterboxd (new tab)";
      link.setAttribute("aria-label", current.title + " — " + link.title);
    }
    if (!link.parentNode) heading.replaceChildren(link);
  }
  $("filmInfo").hidden = false;
  $("filmInfo").setAttribute("aria-busy","false");
  $("credit").textContent = info?.directors?.length ? "Directed by " + info.directors.join(" & ") : "";
  const likes = clip?.likes != null ? new Intl.NumberFormat(undefined, {notation:"compact"}).format(clip.likes) + " trailer likes" : "";
  $("meta").textContent = [current.year, current.certification, info?.runtime, info?.genres?.slice(0,2).join(", "), sourceNames(current)]
    .filter(Boolean).join(" · ");
  $("clipMeta").textContent = [clip?.height ? clip.height + "p source" : "", likes].filter(Boolean).join(" · ");
  $("cue").textContent = "";
  $("hide").disabled = false; $("alternate").disabled = !clip;
  $("next").disabled = false; $("play").disabled = !clip;
  reflectPlayback();
}
function discardIdleYouTube() {
  idleYouTube?.destroy();
  idleYouTube = null;
}
function setStartPending(pending) {
  const button = $("start");
  button.disabled = pending;
  button.setAttribute("aria-busy", String(pending));
  if (pending) button.setAttribute("aria-label", "Loading trailer");
  else button.removeAttribute("aria-label");
}
function resetPlayer(keepYouTube = false) {
  clearTimeout(pendingTimer); playing = false;
  $("stage").classList.toggle("local-hover", keepYouTube && started);
  clearTimeout(idleTimer);
  const old = player; player = null;
  if (keepYouTube && old?.canReuse?.()) {
    idleYouTube = old;
    // A prefetched trailer can load this turn. Pause only if we are still waiting.
    setTimeout(() => { if (idleYouTube === old) old.pause(); }, 0);
  } else old?.destroy();
  if (!keepYouTube) discardIdleYouTube();
  if (!idleYouTube) $("embed").replaceChildren();
  $("art").hidden = $("cover").hidden = keepYouTube && started;
  setStartPending(false);
  $("start").hidden = true;
  captionsOn = false; $("cc").setAttribute("aria-pressed","false");
  $("timeline").value = 0;
  paintRange($("timeline"));
  for (const id of ["timeline","volume","mute","cc"]) $(id).disabled = true;
}
function clearScreen(keepYouTube = false) {
  $("moreControls").setAttribute("aria-expanded", "false");
  $("filmOptions").open = false;
  current = info = clip = null; resetPlayer(keepYouTube);
  for (const id of ["alternate","hide","play","next"]) $(id).disabled = true;
  reflectPlayback();
}
function reflectPlayback() {
  $("play").setAttribute("aria-label", playing ? "Pause" : "Play");
  $("playIcon").setAttribute("href", playing ? "#i-pause" : "#i-play");
}
function clearCaption() {
  $("filmTitle").textContent = $("title").textContent = "";
  $("art").style.backgroundImage = ""; $("screen").classList.remove("has-art");
}
function empty(reason, waiting = false) {
  loading = false; clearScreen();
  $("filmInfo").hidden = !waiting;
  $("filmInfo").setAttribute("aria-busy", String(waiting));
  clearCaption();
  showControls();
  $("cue").textContent = waiting ? "Loading film sources" : "";
  $("title").textContent = waiting ? "" : reason;
}
function restartRound(eligible) {
  if (!eligible.length || !seenFilms.size) return false;
  seenFilms.clear(); seenVideos.clear(); scores.clear(); rebuild();
  if (queue.length > 1 && queue[0].id === lastPlayed) queue.push(queue.shift());
  return true;
}
function skipTo(film = null) {
  // A skip should also count when the previous film's metadata is still loading.
  current?.keys.forEach(key => seenFilms.add(key));
  setNotice(); advance(film);
}
async function advance(requested = null) {
  const run = ++generation;
  const excludeCurrent = current && (!enabled(current) || hidden(current));
  if (excludeCurrent) clearCaption();
  clearScreen(started && !excludeCurrent); loading = true; retrying = false;
  $("filmInfo").hidden = false;
  $("filmInfo").setAttribute("aria-busy","true");
  const eligible = rebuild(false);
  if (!queue.length) restartRound(eligible);
  while (run === generation) {
    let film = requested || queue.shift(); requested = null;
    if (!film) {
      const waiting = Object.keys(SOURCES).some(s => prefs.enabled[s] && !loaded.has(s));
      const enabledAny = Object.values(prefs.enabled).some(Boolean);
      if (seenFilms.size && rebuild().some(f => !matches(f, unavailable)) && restartRound(eligible.filter(f=>!matches(f,unavailable)))) continue;
      renderQueue();
      empty(enabledAny ? "No trailers ready" : "Choose a film source", waiting);
      if (!waiting) setNotice(!enabledAny ? "Turn on a film source to build your queue." :
        (prefs.maxRating ? "Try a higher film rating under Film sources or enable another source." :
          "Try another source or restore movies and trailers in Preferences."));
      return;
    }
    current = film;
    $("next").disabled = false;
    rebuild(false);
    $("cue").textContent = "Looking up trailer"; $("start").hidden = true;
    let data;
    try { data = await detail(film); }
    catch {
      if (run !== generation) return;
      // Keep a transient catalog outage from recursively scanning the whole library.
      if (++failures >= 3) { pauseForRetry("Trailer catalog unavailable. Retry when your connection is ready."); return; }
      film.keys.forEach(k => unavailable.add(k)); continue;
    }
    if (run !== generation) return;
    // A second catalog may have merged new identifiers or a rating while the lookup was running.
    film = current;
    if (data.imdb && !film.keys.includes(data.imdb)) film.keys.push(data.imdb);
    if (matches(film, seenFilms) || hidden(film)) {
      film.keys.forEach(k => seenFilms.add(k)); current = null; rebuild(false); continue;
    }
    const options = playableClips(data);
    if (!options.length) {
      if (data.videos.some(v => seenVideos.has(videoKey(v)))) film.keys.forEach(k => seenFilms.add(k));
      else film.keys.forEach(k => unavailable.add(k));
      current = null; rebuild(false); continue;
    }
    failures = 0; current = film; info = data; clip = options[0]; loading = false;
    film.keys.forEach(k => seenFilms.add(k)); lastPlayed = film.id;
    seenVideos.add(videoKey(clip));
    const safeArt = /^https:\/\//.test(data.art) ? data.art : clip.provider === "youtube" ? "https://i.ytimg.com/vi/" + clip.id + "/hqdefault.jpg" : "";
    $("art").style.backgroundImage = safeArt ? "url(" + JSON.stringify(safeArt) + ")" : "";
    $("screen").classList.toggle("has-art", !!safeArt);
    $("startText").textContent = "Play trailers"; $("start").hidden = started;
    renderFilm(); rebuild();
    if (queue[0]) detail(queue[0]).catch(()=>{});
    if (started) mount();
    return;
  }
}
function pauseForRetry(message) {
  ++generation; empty("Projection paused"); started = false; retrying = true;
  $("startText").textContent = "Retry playback"; $("start").hidden = false; setNotice(message);
}
const sdkPromises = {};
function sdk(name) {
  if (name === "youtube" && window.YT?.Player) return Promise.resolve();
  if (name === "vimeo" && window.Vimeo?.Player) return Promise.resolve();
  if (!sdkPromises[name]) sdkPromises[name] = new Promise((resolve,reject) => {
    const script = el("script");
    const fail = () => { script.remove(); delete sdkPromises[name]; reject(new Error("Player SDK unavailable")); };
    const timeout = setTimeout(fail, 13000);
    const ready = () => { clearTimeout(timeout); resolve(); };
    if (name === "youtube") window.onYouTubeIframeAPIReady = ready;
    else script.onload = ready;
    script.onerror = () => { clearTimeout(timeout); fail(); };
    script.src = name === "youtube" ? "https://www.youtube.com/iframe_api" : "https://player.vimeo.com/api/player.js";
    document.head.append(script);
  });
  return sdkPromises[name];
}
let embedFailures = 0;
function clipFailed(run) {
  if (run !== generation || !clip) return;
  broken.add(videoKey(clip)); clearTimeout(pendingTimer);
  if (++embedFailures >= 5) { pauseForRetry("Several embeds failed. Check your network or browser settings, then retry."); return; }
  const options = playableClips(info);
  if (options.length) {
    ++generation; resetPlayer(); clip = options[0]; seenVideos.add(videoKey(clip)); renderFilm(); mount();
  } else { current.keys.forEach(k => unavailable.add(k)); advance(); }
}
async function mount() {
  if (!clip || player || loading) return;
  let run = ++generation;
  const provider = clip.provider;
  const active = () => run === generation;
  function freshEmbed() {
    if (!active()) return;
    ++generation; resetPlayer(); mount();
  }
  function watchForPlayback(reused) {
    clearTimeout(pendingTimer);
    pendingTimer = setTimeout(() => {
      if (!active()) return;
      if (reused) freshEmbed();
      else pauseForRetry("The video player did not respond. Check the connection and retry.");
    }, reused ? 8000 : 18000);
  }
  const state = on => {
    if (!active()) return;
    clearTimeout(pendingTimer); playing = on;
    $("stage").classList.add("local-hover");
    scheduleControlsHide();
    if (on) { embedFailures = 0; setNotice(); }
    renderFilm();
  };
  const blocked = () => {
    if (!active()) return;
    state(false);
    $("stage").classList.remove("local-hover");
    showControls(); setNotice("Press Play in the video to continue.");
  };
  $("cue").textContent = "";
  $("start").hidden = $("cover").hidden;
  setStartPending(!$("cover").hidden);
  $("stage").classList.add("local-hover");
  try {
    if (provider === "youtube" && idleYouTube) {
      player = idleYouTube; idleYouTube = null;
      try { player.load(clip.id, run); }
      catch { freshEmbed(); }
      return;
    }
    discardIdleYouTube();
    await sdk(provider); if (!active()) return;
    $("cover").hidden = true; $("art").hidden = true;
    $("start").hidden = true; setStartPending(false);
    const target = el("iframe");
    target.tabIndex = -1;
    const params = new URLSearchParams({autoplay:"1", playsinline:"1"});
    target.title = current.title + " trailer";
    target.allow = "autoplay; encrypted-media; fullscreen 'none'";
    if (provider === "youtube") {
      params.set("enablejsapi","1"); params.set("origin",location.origin);
      params.set("fs","0"); params.set("rel","0"); params.set("controls","0");
      params.set("iv_load_policy","3");
      target.src = "https://www.youtube-nocookie.com/embed/" + clip.id + "?" + params;
    } else {
      params.set("fullscreen","0"); params.set("autoplay","0");
      target.src = "https://player.vimeo.com/video/" + clip.id + "?" + params;
    }
    $("embed").replaceChildren(target);
    watchForPlayback(false);
    if (provider === "youtube") {
      let captionDefaultApplied = false;
      let ready = false, hasPlayed = false, reused = false;
      const isSelected = yt => active() && yt.getVideoData()?.video_id === clip?.id;
      let clock;
      function defaultCaptionsOff(yt) {
        if (!active() || captionsOn || captionDefaultApplied || !yt.getOptions?.()?.includes("captions")) return;
        captionDefaultApplied = true;
        yt.setOption("captions", "track", {});
        yt.unloadModule?.("captions");
      }
      function applyCaptions(yt) {
        if (!captionsOn) return defaultCaptionsOff(yt);
        const tracks = yt.getOption?.("captions", "tracklist") || [];
        const track = tracks.find(t => t.languageCode === "en") || tracks[0];
        if (track) yt.setOption("captions", "track", track);
        else yt.setOption("captions", "track", {languageCode:"en"});
      }
      const yt = new YT.Player(target, { host:"https://www.youtube-nocookie.com",
        events:{onReady:e=>{
          if (!active()) return;
          ready = true;
          defaultCaptionsOff(e.target);
          audioReady(e.target.getVolume());
          clock = setInterval(()=>{if(hasPlayed && isSelected(yt)) position(yt.getCurrentTime(),yt.getDuration());},500);
          e.target.playVideo();renderFilm();
        },onApiChange:e=>{if(isSelected(e.target))applyCaptions(e.target);},
          onStateChange:e=>{
            if (!isSelected(e.target)) return;
            if (e.data === YT.PlayerState.ENDED && hasPlayed) advance();
            if (e.data === YT.PlayerState.PLAYING) {
              if (reused && !hasPlayed) audioReady(e.target.getVolume());
              hasPlayed = true; defaultCaptionsOff(e.target); state(true);
            }
            if (e.data === YT.PlayerState.PAUSED && hasPlayed) state(false);
          },onError:()=>{
            if (active() && reused && !hasPlayed) freshEmbed();
            else clipFailed(run);
          },onAutoplayBlocked:blocked}});
      player = {canReuse:()=>ready,
        load:(id,nextRun)=>{
          run = nextRun; reused = true; hasPlayed = false; captionDefaultApplied = false;
          yt.getIframe().title = current.title + " trailer";
          watchForPlayback(true);
          yt.loadVideoById(id);
        },
        play:()=>yt.playVideo?.(),pause:()=>yt.pauseVideo?.(),seek:offset=>yt.seekTo?.(Math.max(0,(yt.getCurrentTime?.()||0)+offset),true),
        seekTo:t=>yt.seekTo(t,true), volume:n=>yt.setVolume(n), mute:on=>on?yt.mute():yt.unMute(),
        captions:on=>{
          captionDefaultApplied = true;
          if(on){yt.loadModule?.("captions");applyCaptions(yt);}
          else {yt.setOption("captions","track",{});yt.unloadModule?.("captions");}
        },
        destroy:()=>{clearInterval(clock);yt.destroy();}};
    } else {
      const v = new Vimeo.Player(target);
      const play = () => v.play().catch(e=>e.name === "NotAllowedError" ? blocked() : clipFailed(run));
      player = {play,pause:()=>v.pause().catch(()=>{}),seek:async offset=>{try{await v.setCurrentTime(Math.max(0,Math.min(await v.getDuration(),(await v.getCurrentTime())+offset)));}catch{}},
        seekTo:t=>v.setCurrentTime(t).catch(()=>{}),volume:n=>v.setVolume(n/100).catch(()=>{}),mute:on=>v.setMuted(on).catch(()=>{}),
        captions:async on=>{
          if (!on) return v.disableTextTrack();
          const tracks = await v.getTextTracks();
          const track = tracks.find(t=>t.language==="en") || tracks[0];
          if (!track) throw Error("No captions");
          return v.enableTextTrack(track.language,track.kind);
        },destroy:()=>v.destroy().catch(()=>{})};
      v.on("timeupdate",e=>{if(active())position(e.seconds,e.duration);});
      v.on("ended",()=>{if(active())advance();}); v.on("play",()=>state(true)); v.on("pause",()=>state(false));
      v.on("error",()=>clipFailed(run)); v.ready().then(async()=>{
        if (!active()) return;
        await v.disableTextTrack().catch(()=>{});
        const volume = await v.getVolume().catch(()=>1);
        if(active()){audioReady(volume*100);play();renderFilm();}
      }).catch(()=>clipFailed(run));
    }
  } catch { if (active()) pauseForRetry("Could not load the " + provider + " player. Check the connection and retry."); }
}
function paintRange(input) {
  input.style.setProperty("--fill", (100 * input.valueAsNumber / Number(input.max)) + "%");
}
function position(seconds,duration) {
  if (!(duration > 0)) return;
  $("timeline").max = duration;
  if (!$("timeline").matches(":active")) $("timeline").value = seconds;
  paintRange($("timeline"));
  $("timeline").disabled = false;
}
function reflectMute() {
  paintRange($("volume"));
  const muted = prefs.muted || Number($("volume").value) === 0;
  $("volumeIcon").setAttribute("href",muted ? "#i-muted" : "#i-volume");
  $("mute").title = muted ? "Unmute" : "Mute";
  $("mute").setAttribute("aria-label",$("mute").title);
}
function audioReady(initialVolume) {
  $("volume").value = prefs.volume ?? initialVolume;
  if (prefs.volume !== null) player.volume(prefs.volume);
  player.mute(prefs.muted);
  for (const id of ["volume","mute","cc"]) $(id).disabled = false;
  reflectMute();
}
$("timeline").oninput = () => { paintRange($("timeline")); player?.seekTo(Number($("timeline").value)); };
$("volume").oninput = () => {
  prefs.volume = Number($("volume").value); prefs.muted = prefs.volume === 0;
  player?.volume(prefs.volume); player?.mute(prefs.muted); reflectMute(); save();
};
$("mute").onclick = () => {
  if (Number($("volume").value) === 0) { $("volume").value = 50; $("volume").oninput(); return; }
  prefs.muted = !prefs.muted; player?.mute(prefs.muted); reflectMute(); save();
};
$("cc").onclick = async () => {
  const run = generation;
  captionsOn = !captionsOn; $("cc").setAttribute("aria-pressed",String(captionsOn));
  try { await player?.captions(captionsOn); }
  catch { if(run===generation){captionsOn=false;$("cc").setAttribute("aria-pressed","false");setNotice("Captions unavailable for this trailer.");} }
};
function play() {
  if ($("start").disabled || (!clip && !retrying)) return;
  $("stage").dataset.transport = "playback";
  setNotice();
  started = true;
  if (retrying) { unavailable.clear(); broken.clear(); seenFilms.clear(); seenVideos.clear(); embedFailures = failures = 0; advance(); return; }
  if (player) { if (playing) player.pause(); else player.play(); } else mount();
}
$("start").onclick = $("play").onclick = play;
document.addEventListener("click", e => {
  if ($("filmOptions").open && !$("filmOptions").contains(e.target)) $("filmOptions").open = false;
});
$("next").onclick = () => skipTo();
$("hide").onclick = () => {
  if (!current) return;
  prefs.hidden.push({keys:[...current.keys],title:current.title,year:current.year}); save();
  setNotice(current.title + " hidden. Restore it in Preferences."); advance();
};
$("alternate").onclick = () => {
  if (!clip || !current) return;
  prefs.skipped.push({video:videoKey(clip), title:current.title, year:current.year}); save();
  setNotice("Skipped this trailer for " + current.title + ". Only other versions can return."); advance();
};
function sizeTube() {
  if (!prefs.crt) return;
  const screen = $("screen");
  const dpr = window.devicePixelRatio || 1;
  const pitch = Math.max(2, Math.round(screen.clientHeight * dpr / 420)) / dpr;
  screen.style.setProperty("--beam", pitch + "px");
  screen.style.setProperty("--triad", 3 / dpr + "px");
}
function applyTube() {
  $("screen").classList.toggle("crt-on",prefs.crt);
  $("crt").setAttribute("aria-pressed", String(prefs.crt));
  sizeTube();
}
applyTube();
new ResizeObserver(sizeTube).observe($("screen"));
$("crt").onclick = () => {prefs.crt = !prefs.crt; applyTube(); save();};
function scheduleControlsHide() {
  clearTimeout(idleTimer);
  if (playing && !$("stage").classList.contains("controls-hidden") && !adjustingControl && $("moreControls").getAttribute("aria-expanded") !== "true" && !(keyboardControl && $("dock").contains(document.activeElement))) {
    idleTimer = setTimeout(() => {
      if (document.hasFocus() && $("dock").contains(document.activeElement)) $("stage").focus({preventScroll:true});
      $("stage").classList.add("controls-hidden");
    }, matchMedia("(pointer: coarse)").matches ? 4000 : 2400);
  }
}
// Key events inside a provider iframe never bubble to this page. Return keyboard
// focus to the screen after the embed receives it, including on a trailer change.
function reclaimEmbedFocus() {
  if (document.hasFocus() && document.activeElement?.parentElement === $("embed")) {
    $("stage").focus({preventScroll:true});
  }
}
window.addEventListener("blur", () => requestAnimationFrame(reclaimEmbedFocus));
window.addEventListener("focus", () => requestAnimationFrame(reclaimEmbedFocus));
function showControls() {
  $("stage").classList.remove("controls-hidden");
  scheduleControlsHide();
}
$("moreControls").onclick = () => {
  const button = $("moreControls");
  button.setAttribute("aria-expanded", String(button.getAttribute("aria-expanded") !== "true"));
  showControls();
};
function closeViewTools() {
  if ($("moreControls").getAttribute("aria-expanded") !== "true") return;
  if ($("viewTools").contains(document.activeElement)) $("moreControls").focus({preventScroll:true});
  $("moreControls").setAttribute("aria-expanded", "false");
  scheduleControlsHide();
}
document.addEventListener("click", e => { if (!$("moreControls").contains(e.target)) closeViewTools(); });
window.addEventListener("resize", closeViewTools);
const layout = $("theater").closest("main");
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
let sizeMotion, sidebarMotion;
function stopLayoutMotion() {
  sizeMotion?.cancel(); sidebarMotion?.cancel();
}
function reflectTheaterMode() {
  layout.classList.toggle("theater-mode", prefs.wide);
  fitQueuePreview();
  $("wide").setAttribute("aria-pressed", String(prefs.wide));
  $("wide").title = prefs.wide ? "Exit theater mode (T)" : "Theater mode (T)";
}
function toggleTheaterMode() {
  if (document.fullscreenElement || $("theater").classList.contains("expanded")) return;
  const stage = $("stage");
  const from = stage.getBoundingClientRect();
  const fromRadius = getComputedStyle(stage).borderTopLeftRadius;
  stopLayoutMotion();
  prefs.wide = !prefs.wide; reflectTheaterMode(); save(); showControls();
  if (reduceMotion.matches) return;
  const to = stage.getBoundingClientRect();
  const margin = parseFloat(getComputedStyle(stage).marginLeft);
  // Resize the frame around the live 16:9 image. Sampling the current bounds also
  // lets a second press reverse an in-flight transition from its visible position.
  sizeMotion = stage.animate({
    width: [from.width + "px", to.width + "px"], height: [from.height + "px", to.height + "px"],
    borderRadius: [fromRadius, getComputedStyle(stage).borderTopLeftRadius],
    marginLeft: [(margin + from.left - to.left) + "px", margin + "px"],
    maxHeight: ["none", "none"], zIndex: [1, 1]
  }, {duration: 240, easing: "cubic-bezier(.22, 1, .36, 1)"});
  sidebarMotion = layout.querySelector("aside").animate([{opacity: 0}, {opacity: 1}],
    {duration: 160, delay: 80, easing: "ease-out", fill: "backwards"});
}
reflectTheaterMode();
$("wide").onclick = toggleTheaterMode;
window.addEventListener("resize", stopLayoutMotion);
window.addEventListener("resize", fitQueuePreview);
new ResizeObserver(fitQueuePreview).observe(layout.querySelector(".sources"));
reduceMotion.addEventListener("change", stopLayoutMotion);
$("stage").addEventListener("pointermove", () => { keyboardControl = false; showControls(); });
// Keep motion over the picture in the page even after the dock has appeared.
// A tap on playing video reveals controls. A tap on paused video resumes it.
document.querySelector(".wake-surface").addEventListener("click", e => {
  if (!playing) player?.play();
  else if (e.pointerType === "mouse") player?.pause();
});
$("stage").addEventListener("pointerdown", e => {
  keyboardControl = false; adjustingControl = $("dock").contains(e.target); showControls();
});
for (const event of ["pointerup","pointercancel"]) {
  window.addEventListener(event, () => { if (adjustingControl) { adjustingControl = false; showControls(); } });
}
$("dock").addEventListener("focusin", showControls);
$("dock").addEventListener("focusout", () => queueMicrotask(scheduleControlsHide));
function fullscreenControls() {
  stopLayoutMotion();
  showControls();
  const expanded = !!document.fullscreenElement || $("theater").classList.contains("expanded");
  const label = expanded ? "Exit fullscreen" : "Fullscreen";
  $("full").setAttribute("aria-label", label); $("full").title = label + " (F)";
  $("fullIcon").setAttribute("href", expanded ? "#i-exit" : "#i-full");
}
$("full").onclick = async () => {
  const theater = $("theater");
  if (theater.classList.contains("expanded")) theater.classList.remove("expanded");
  else if (document.fullscreenElement) await document.exitFullscreen();
  else {
    try { await theater.requestFullscreen(); }
    catch { theater.classList.add("expanded"); }
  }
  fullscreenControls();
};
document.addEventListener("fullscreenchange",fullscreenControls);
for (const rating of US_RATINGS) $("maxRating").add(new Option(rating, rating));
$("maxRating").value = prefs.maxRating;
$("ratingHint").hidden = !prefs.maxRating;
$("maxRating").onchange = () => {
  prefs.maxRating = $("maxRating").value;
  $("ratingHint").hidden = !prefs.maxRating;
  save(); setNotice(); sourcesChanged();
};
function preferences() {
  for (const [field,id,none] of [["hidden","hiddenList","No hidden movies."],["skipped","skippedList","No skipped trailers."]]) {
    const list = $(id); list.replaceChildren();
    if (!prefs[field].length) list.append(el("p","",none));
    for (const item of prefs[field]) {
      const line = el("div","restore"), btn = el("button","","Restore");
      const details = el("div","restore-details"), title = el("div","restore-title",item.title);
      if (item.year) title.append(" ", el("span","restore-year",item.year));
      details.append(title);
      if (field === "skipped" && item.video) {
        const [provider, videoId] = item.video.split("/");
        const name = {youtube:"YouTube", vimeo:"Vimeo"}[provider] || provider;
        const reference = el("div","restore-reference",[name, videoId].filter(Boolean).join(" · "));
        reference.title = reference.textContent;
        details.append(reference);
      }
      line.append(details,btn);
      btn.onclick = () => {prefs[field] = prefs[field].filter(x=>x!==item); unavailable.clear();save();preferences();sourcesChanged();};
      list.append(line);
    }
  }
}
$("preferences").onclick = () => {preferences();$("settings").showModal();};
$("close").onclick = () => $("settings").close();
document.addEventListener("keydown",e=>{
  const key = e.key.toLowerCase();
  if (key === "escape" && $("moreControls").getAttribute("aria-expanded") === "true") { closeViewTools(); return; }
  if ($("filmOptions").open && key === "escape") {
    $("filmOptions").open = false;
    $("filmOptions").querySelector("summary").focus();
    return;
  }
  if (!["n","mediatracknext","arrowleft","arrowright"].includes(key)) {
    keyboardControl = true; showControls();
  }
  if (e.key === "Escape" && $("theater").classList.contains("expanded")) { $("full").click(); return; }
  if ($("settings").open || e.ctrlKey || e.altKey || e.metaKey || e.repeat || e.target.isContentEditable ||
      e.target.matches("textarea, select, input:not([type=range]):not([type=checkbox])")) return;
  if (key === "escape" && prefs.wide && !document.fullscreenElement) { toggleTheaterMode(); return; }
  if (e.key === " " && e.target.matches("button, input, summary")) return;
  if ((key === "arrowleft" || key === "arrowright") && e.target.matches("input[type=range]")) return;
  const next = () => $("next").click();
  const action = {" ":play,n:next,mediatracknext:next,t:toggleTheaterMode,f:()=>$("full").click(),
    arrowleft:()=>player?.seek(-10),arrowright:()=>player?.seek(10)}[key];
  if(action){e.preventDefault();action();}
});
let pollTimer, syncVersion = 0;
async function syncCollections() {
  const version = ++syncVersion;
  clearTimeout(pollTimer);
  try {
    const data = await json("/api/collections");
    if (version !== syncVersion) return;
    const changed = Object.keys(SOURCES).some(key => sourceStatus[key]?.updated !== data.sources[key].updated ||
      sourceStatus[key]?.refreshing !== data.sources[key].refreshing);
    sourceStatus = data.sources;
    Object.assign(catalogs, data.catalogs);
    for (const [key, state] of Object.entries(sourceStatus)) {
      if (state.updated || state.error) loaded.add(key);
    }
    if (changed) sourcesChanged();
    else renderSources();
    if (Object.values(sourceStatus).some(state => state.refreshing)) {
      pollTimer = setTimeout(syncCollections, 2500);
    }
  } catch {
    if (version !== syncVersion) return;
    setNotice("Could not reach the local catalog service. Retrying shortly.");
    pollTimer = setTimeout(syncCollections, 15000);
  }
}
renderSources();
syncCollections();
