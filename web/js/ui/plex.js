// Plex setup inside the Programming sheet: sign-in hand-off, server and library pickers, connect and remove.
// The Plex source row's menu (programming.js) starts these through the functions returned below.
import {$, reveal} from "../dom.js";
import {plexCall as call} from "../api.js";

const flowKey = "trailer-room.plex-setup";
const removalKey = "trailer-room.plex-remove";

function options(select, prompt, entries = []) {
  select.replaceChildren(new Option(prompt, ""), ...entries.map(item => new Option(item.name, item.id)));
  select.disabled = !entries.length;
}

// sync(force) reloads the collections after the library changes.
export function plexPreferences(sync) {
  const picker = $("plexPicker");
  const server = $("plexServer");
  const library = $("plexLibrary");
  const save = $("plexSave");
  const message = $("plexMessage");
  let state;
  let flow;
  let busy = false;

  function status(source) {
    state = source;
  }
  status(null);

  async function signIn(removeConnection = "") {
    if (busy) {
      return;
    }
    busy = true;
    message.textContent = "Opening Plex sign-in…";
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
      message.textContent = error.message;
      busy = false;
    }
  }

  async function removed() {
    sessionStorage.removeItem(flowKey);
    reveal(picker, false);
    await sync(true);
    message.textContent = "Library removed from Trailer Room.";
  }

  async function resume() {
    try {
      flow = sessionStorage.getItem(flowKey);
      if (!flow) {
        throw Error("Start a new Plex sign-in in this tab.");
      }
      const connection = sessionStorage.getItem(removalKey);
      if (connection) {
        sessionStorage.removeItem(removalKey);
        message.textContent = "Removing library…";
        await call("disconnect", {flow, connection});
        await removed();
        return;
      }
      message.textContent = "Finding your servers…";
      const result = await call("servers", {flow});
      options(server, "Choose a server", result.servers);
      options(library, "Choose a library");
      reveal(picker, true);
      message.textContent = result.servers.length ? "" : "No accessible Plex servers with secure connections were found.";
    } catch (error) {
      message.textContent = error.message;
    }
  }

  server.onchange = async () => {
    const selected = server.value;
    options(library, "Choose a library");
    save.disabled = true;
    message.textContent = "";
    if (!selected) {
      return;
    }
    message.textContent = "Finding libraries…";
    try {
      const result = await call("libraries", {flow, server: selected});
      if (server.value !== selected) {
        return;
      }
      options(library, "Choose a library", result.libraries);
      message.textContent = result.libraries.length ? "" : "This server has no accessible film libraries.";
    } catch (error) {
      if (server.value === selected) {
        message.textContent = error.message;
      }
    }
  };
  library.onchange = () => {
    save.disabled = !library.value;
  };
  $("plexCancel").onclick = () => {
    sessionStorage.removeItem(flowKey);
    flow = null;
    reveal(picker, false);
    message.textContent = "";
  };

  async function connect() {
    const body = {flow, server: server.value, library: library.value};
    server.disabled = library.disabled = save.disabled = $("plexCancel").disabled = true;
    busy = true;
    message.textContent = "Importing films…";
    try {
      await call("connect", body);
      sessionStorage.removeItem(flowKey);
      reveal(picker, false);
      await sync(true);
      message.textContent = "Library connected.";
    } catch (error) {
      message.textContent = error.message;
    } finally {
      server.disabled = server.options.length < 2;
      library.disabled = library.options.length < 2;
      save.disabled = !library.value;
      busy = false;
      $("plexCancel").disabled = false;
    }
  }
  picker.onsubmit = event => {
    event.preventDefault();
    if (library.value) {
      connect();
    }
  };
  async function remove() {
    if (busy || !state || !confirm('Remove “' + state.name + '” from Trailer Room for everyone on this installation?')) {
      return;
    }
    const connection = state.connection;
    busy = true;
    message.textContent = "Removing library…";
    try {
      const result = await call("disconnect", {connection, ...(picker.hidden ? {} : {flow})});
      if (result.signInRequired) {
        return await signIn(connection);
      }
      await removed();
    } catch (error) {
      message.textContent = error.message;
    } finally {
      busy = false;
    }
  }
  return {status, resume, start: () => signIn(), remove};
}
