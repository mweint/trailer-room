// Plex: the logic behind the Plex section of Programming, which programming.js draws. Connecting signs in with
// Plex, then imports every film library on the chosen server (asking which server only when there are several);
// each library is then switched on or off where it is listed. Removing disconnects the server.
import {$, resize} from "../dom.js";
import {plexCall as call} from "../api.js";

const flowKey = "trailer-room.plex-setup";
const removalKey = "trailer-room.plex-remove";
const PROGRESS_DELAY = 400;

// sync(force) reloads the collections after the libraries change. redraw(opening) redraws the Plex section,
// animating its height when opening is given.
export function plexPreferences(sync, redraw) {
  const message = $("plexMessage");
  let state = null;
  let flow = null;
  let servers = null;
  let busy = false;
  let pending;

  // The message line shows only work in progress and errors, and grows and shrinks with its text.
  // Progress text appears only if the wait passes PROGRESS_DELAY, so a quick step never flashes it.
  function show(text) {
    if (message.textContent !== text) {
      resize(message, () => {
        message.textContent = text;
      }, !!text, true);
    }
  }

  function working(text) {
    clearTimeout(pending);
    pending = setTimeout(() => show(text), PROGRESS_DELAY);
  }

  function say(text) {
    clearTimeout(pending);
    show(text);
  }

  // The connected server: {server, connection, libraries: ["plex-<key>", ...]}, or null.
  function status(source) {
    state = source;
  }

  // After sign-in, the servers to choose from when the account has several; otherwise null.
  function choosing() {
    return servers;
  }

  function finish() {
    servers = null;
    flow = null;
    sessionStorage.removeItem(flowKey);
  }

  async function signIn(removeConnection = "") {
    if (busy) {
      return;
    }
    busy = true;
    working("Opening Plex sign-in…");
    try {
      const result = await call("begin");
      sessionStorage.setItem(flowKey, result.flow);
      if (removeConnection) {
        sessionStorage.setItem(removalKey, removeConnection);
      } else {
        sessionStorage.removeItem(removalKey);
      }
      location.assign(result.url);
    } catch (error) {
      say(error.message);
      busy = false;
    }
  }

  // Imports every film library on the server.
  async function chooseServer(id) {
    if (busy || !id) {
      return;
    }
    busy = true;
    working("Importing films…");
    try {
      await call("libraries", {flow, server: id});
      await call("connect", {flow, server: id});
      const wasChoosing = !!servers;
      finish();
      say("");
      await sync(true);
      redraw(wasChoosing ? false : undefined);
    } catch (error) {
      say(error.message);
    } finally {
      busy = false;
    }
  }

  function cancel() {
    if (servers) {
      finish();
      say("");
      redraw(false);
    }
  }

  // Back from Plex sign-in: finish a removal that needed it, or connect a server.
  async function resume() {
    try {
      flow = sessionStorage.getItem(flowKey);
      if (!flow) {
        throw Error("Start a new Plex sign-in in this tab.");
      }
      const connection = sessionStorage.getItem(removalKey);
      if (connection) {
        sessionStorage.removeItem(removalKey);
        working("Removing Plex…");
        await call("disconnect", {flow, connection});
        finish();
        say("");
        await sync(true);
        return;
      }
      working("Finding your servers…");
      const result = await call("servers", {flow});
      if (!result.servers.length) {
        say("No accessible Plex servers with secure connections were found.");
        return;
      }
      say("");
      if (result.servers.length === 1) {
        await chooseServer(result.servers[0].id);
      } else {
        servers = result.servers;
        redraw(true);
      }
    } catch (error) {
      say(error.message);
    }
  }

  async function remove() {
    if (busy || !state || !confirm("Remove Plex (" + state.server + ") from Trailer Room for everyone on this installation?")) {
      return;
    }
    const connection = state.connection;
    busy = true;
    working("Removing Plex…");
    try {
      const result = await call("disconnect", {connection});
      if (result.signInRequired) {
        busy = false;
        return await signIn(connection);
      }
      say("");
      await sync(true);
    } catch (error) {
      say(error.message);
    } finally {
      busy = false;
    }
  }

  return {status, resume, choosing, connect: () => signIn(), chooseServer, cancel, remove};
}
