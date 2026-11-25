// Plex: the logic behind the Plex group in Programming, which programming.js draws. Sign-in hand-off, the
// connecting browser's library edit without sign-in, choosing a server and libraries, saving and removing.
// While editing, the Plex group itself becomes the editor: a switch per library, Cancel and Save in its heading.
import {$, resize} from "../dom.js";
import {plexCall as call} from "../api.js";

const flowKey = "trailer-room.plex-setup";
const removalKey = "trailer-room.plex-remove";
const PROGRESS_DELAY = 400;

const marked = (entries, connected) =>
  entries.map(item => ({id: item.id, name: item.name, on: connected.includes("plex-" + item.id)}));

// sync(force) reloads the collections after the libraries change. redraw(opening) redraws the Plex group,
// animating its height when opening is given.
export function plexPreferences(sync, redraw) {
  const message = $("plexMessage");
  let state = null;
  let flow = null;
  let edit = null;
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

  // The edit in progress: {servers (signed in) or null, server, serverName, libraries: [{id, name, on}]}, or null.
  function editing() {
    return edit;
  }

  function startEditing(next) {
    const opening = !edit;
    edit = next;
    redraw(opening ? true : undefined);
  }

  function stopEditing() {
    if (!edit) {
      return;
    }
    edit = null;
    flow = null;
    sessionStorage.removeItem(flowKey);
    say("");
    redraw(false);
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

  // Change: the browser that connected Plex edits the connected server's libraries straight away;
  // anywhere else, or with nothing connected, signs in first.
  async function change() {
    if (busy) {
      return;
    }
    if (!state) {
      return signIn();
    }
    working("Finding libraries…");
    try {
      const result = await call("manage");
      if (result.signInRequired) {
        return signIn();
      }
      say("");
      startEditing({servers: null, server: null, serverName: result.server,
        libraries: marked(result.libraries, state.libraries)});
    } catch (error) {
      say(error.message);
    }
  }

  async function chooseServer(id) {
    const server = edit.servers.find(item => item.id === id);
    startEditing({...edit, server: id, serverName: server?.name || "", libraries: []});
    if (!server) {
      return;
    }
    working("Finding libraries…");
    try {
      const result = await call("libraries", {flow, server: id});
      if (edit?.server !== id) {
        return;
      }
      const same = state && server.name === state.server;
      say(result.libraries.length ? "" : "This server has no accessible film libraries.");
      startEditing({...edit, libraries: marked(result.libraries, same ? state.libraries : [])});
    } catch (error) {
      say(error.message);
    }
  }

  function toggle(id, on) {
    const library = edit?.libraries.find(item => item.id === id);
    if (library) {
      library.on = on;
    }
  }

  async function save() {
    const library = edit?.libraries.filter(item => item.on).map(item => item.id).join(",");
    if (busy || !library) {
      return;
    }
    busy = true;
    working("Importing films…");
    try {
      const result = await call("connect", flow ? {flow, server: edit.server, library} : {library});
      if (result.signInRequired) {
        busy = false;
        return await signIn();
      }
      edit = null;
      flow = null;
      sessionStorage.removeItem(flowKey);
      say("");
      await sync(true);
      redraw(false);
    } catch (error) {
      say(error.message);
    } finally {
      busy = false;
    }
  }

  async function removed() {
    sessionStorage.removeItem(flowKey);
    edit = null;
    flow = null;
    say("");
    await sync(true);
  }

  // Back from Plex sign-in: finish a removal that needed it, or start choosing a server and libraries.
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
        await removed();
        return;
      }
      working("Finding your servers…");
      const result = await call("servers", {flow});
      if (!result.servers.length) {
        say("No accessible Plex servers with secure connections were found.");
        return;
      }
      say("");
      startEditing({servers: result.servers, server: null, serverName: "", libraries: []});
      // With a single server there is nothing to choose: take it and list its libraries.
      if (result.servers.length === 1) {
        await chooseServer(result.servers[0].id);
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
      const result = await call("disconnect", {connection, ...(flow ? {flow} : {})});
      if (result.signInRequired) {
        busy = false;
        return await signIn(connection);
      }
      await removed();
    } catch (error) {
      say(error.message);
    } finally {
      busy = false;
    }
  }

  return {status, resume, editing, change, cancel: stopEditing, chooseServer, toggle, save,
    otherServer: () => signIn(), remove};
}
