// Start-up and wiring only: builds the view the playback layer talks to and starts each ui module in order.
import {letterboxdLink} from "./catalog.js";
import {onSync, syncCollections} from "./library.js";
import {onStorageFailure} from "./prefs.js";
import {connectController, sourcesChanged} from "./playback/controller.js";
import * as screen from "./ui/screen.js";
import * as dock from "./ui/dock.js";
import * as transport from "./ui/transport.js";
import * as filmInfo from "./ui/film-info.js";
import * as theater from "./ui/theater.js";
import * as preferences from "./ui/preferences.js";
import {initCrt} from "./ui/crt.js";
import {renderQueue, fitQueuePreview, initQueue} from "./ui/queue.js";
import {renderProgramming, initProgramming} from "./ui/programming.js";
import {plexPreferences} from "./ui/plex.js";
import {initShortcuts} from "./ui/shortcuts.js";

// Everything the playback layer may ask of the page. Each entry spans the ui
// modules that own the elements involved, so those modules never import each other.
const view = {
  notice: screen.setNotice,
  renderQueue,
  renderProgramming,
  renderFilm(film, info, clip, playing) {
    const link = letterboxdLink(film, info);
    transport.showFilmControls(link, !!clip, playing);
    filmInfo.showFilmInfo(film, info, clip, link);
    screen.setCue("");
  },
  menusClosed() {
    dock.collapseViewTools();
    filmInfo.closeFilmOptions();
  },
  filmCleared(playing) {
    filmInfo.disableFilmActions();
    transport.disableFilmControls(playing);
  },
  clearCaption() {
    filmInfo.clearFilmTitle();
    transport.setTitleText("");
    screen.setArt("");
  },
  empty(reason, waiting) {
    filmInfo.setFilmInfoState(!waiting, waiting);
    view.clearCaption();
    dock.showControls();
    screen.setCue(waiting ? "Loading film sources" : "");
    transport.setTitleText(waiting ? "" : reason);
  },
  filmLoading() {
    filmInfo.setFilmInfoState(false, true);
  },
  lookingUp() {
    transport.enableNext();
    screen.setCue("Looking up trailer");
    screen.hideStart();
  },
  art: screen.setArt,
  startOffered: screen.offerStart,
  startDisabled: screen.startDisabled,
  transport: dock.setTransport,
  playerReset(keepPicture, clearEmbed) {
    dock.setLocalHover(keepPicture);
    dock.cancelControlsHide();
    screen.resetScreen(keepPicture, clearEmbed);
    transport.resetTransport();
  },
  mountStarting() {
    screen.mountStarting();
    dock.setLocalHover(true);
  },
  showEmbed: screen.showEmbed,
  playbackChanged() {
    dock.setLocalHover(true);
    dock.scheduleControlsHide();
  },
  autoplayBlocked() {
    dock.setLocalHover(false);
    dock.showControls();
  },
  volumeShown: transport.showVolume,
  audioReady: transport.enableAudio,
  position: transport.showPosition,
  captions: transport.setCaptionsPressed
};

onStorageFailure(screen.setNotice);
connectController(view);

// The order below fixes both the first paint and the order of the shared
// document and window listeners.
screen.initScreen();
transport.initTransport();
filmInfo.initFilmInfo(screen.setNotice);
initCrt();
dock.initDock();
theater.initTheater({showControls: dock.showControls, layoutChanged: fitQueuePreview});
initQueue();
initProgramming(screen.setNotice);
preferences.initPreferences();
initShortcuts({
  viewToolsOpen: dock.viewToolsOpen,
  closeViewTools: dock.closeViewTools,
  keyboardUsed: dock.keyboardUsed,
  filmOptionsOpen: filmInfo.filmOptionsOpen,
  dismissFilmOptions: filmInfo.dismissFilmOptions,
  isExpanded: theater.isExpanded,
  clickFullscreen: theater.clickFullscreen,
  toggleTheaterMode: theater.toggleTheaterMode,
  preferencesOpen: preferences.preferencesOpen,
  clickNext: transport.clickNext
});

const plexSetup = plexPreferences(syncCollections);
onSync({
  plexStatus: plexSetup.status,
  changed: sourcesChanged,
  unchanged: renderProgramming,
  notice: screen.setNotice
});
renderProgramming();
syncCollections();
if (location.hash === "#plex-setup") {
  history.replaceState(null, "", location.pathname + location.search);
  preferences.clickPreferences();
  plexSetup.resume();
}
