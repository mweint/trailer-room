// Plex: the logic behind the Plex section of Programming, which programming.js draws. Connecting signs in with
// Plex, asks which server when the account has several, then lists the server's film libraries to tick; only the
// ticked ones are imported. Edit reopens that list (the browser that connected needs no new sign-in; another
// browser signs in first). Removing disconnects the server.
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
  let picking = null;
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

  // What the section is asking for: {servers} after sign-in on an account with several servers, or {picking} while
  // libraries are being ticked: {server, libraries: [{id, name}], chosen: Set of ids}. Otherwise null.
  function choosing() {
    return servers ? {servers} : picking ? {picking} : null;
  }

  function finish() {
    servers = null;
    picking = null;
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

  // Opens the list of the server's film libraries, ticking those already added on this server.
  function pick(server, name, libraries) {
    const added = state && state.server === name ? state.libraries : [];
    const chosen = new Set(libraries.filter(l => added.includes("plex-" + l.id)).map(l => l.id));
    if (libraries.length === 1) {
      chosen.add(libraries[0].id);
    }
    const opening = !servers && !picking;
    servers = null;
    picking = {server, name, libraries, chosen};
    redraw(opening ? true : undefined);
  }

  async function chooseServer(id, offered = servers) {
    if (busy || !id) {
      return;
    }
    const name = offered?.find(s => s.id === id)?.name || "";
    busy = true;
    working("Finding your libraries…");
    try {
      const result = await call("libraries", {flow, server: id});
      say("");
      if (!result.libraries.length) {
        say("This server has no film libraries.");
        return;
      }
      pick(id, name, result.libraries);
    } catch (error) {
      say(error.message);
    } finally {
      busy = false;
    }
  }

  // Edit: the browser that connected lists the libraries straight away; any other signs in first.
  async function edit() {
    if (busy || !state) {
      return;
    }
    busy = true;
    working("Finding your libraries…");
    try {
      const result = await call("libraries");
      if (result.signInRequired) {
        busy = false;
        return await signIn();
      }
      say("");
      pick("", state.server, result.libraries);
    } catch (error) {
      say(error.message);
    } finally {
      busy = false;
    }
  }

  function tick(id, on) {
    if (picking) {
      picking.chosen[on ? "add" : "delete"](id);
      redraw();
    }
  }

  async function save() {
    if (busy || !picking?.chosen.size) {
      return;
    }
    busy = true;
    working("Importing films…");
    const library = [...picking.chosen].join(",");
    try {
      const result = await call("connect", flow ? {flow, server: picking.server, library} : {library});
      if (result.signInRequired) {
        busy = false;
        return await signIn();
      }
      finish();
      say("");
      await sync(true);
      redraw(false);
    } catch (error) {
      say(error.message);
    } finally {
      busy = false;
    }
  }

  function cancel() {
    if (servers || picking) {
      finish();
      say("");
      redraw(false);
    }
  }

  // Back from Plex sign-in: finish a removal that needed it, or go on to the servers and libraries.
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
        await chooseServer(result.servers[0].id, result.servers);
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

  return {status, resume, choosing, connect: () => signIn(), chooseServer, edit, tick, save, cancel, remove};
}
