// Plex setup inside Preferences: sign-in hand-off, server and library pickers, connect and remove.
import {$} from "../dom.js";
import {plexCall as call} from "../api.js";

const flowKey = "trailer-room.plex-setup";
const removalKey = "trailer-room.plex-remove";

function options(select, prompt, entries = []) {
  select.replaceChildren(new Option(prompt, ""), ...entries.map(item => new Option(item.name, item.id)));
  select.disabled = !entries.length;
}

// sync(force) reloads the collections after the library changes.
export function plexPreferences(sync) {
  const begin = $("plexBegin");
  const picker = $("plexPicker");
  const server = $("plexServer");
  const library = $("plexLibrary");
  const save = $("plexSave");
  const disconnect = $("plexDisconnect");
  const message = $("plexMessage");
  let state;
  let flow;

  function status(source) {
    state = source;
    $("plexSummary").textContent = state ? state.server + " / " + state.name : "Add films from a library you choose.";
    begin.textContent = state ? "Change library" : "Connect Plex";
    disconnect.hidden = !state;
  }
  status(null);

  async function signIn(removeConnection = "") {
    begin.disabled = disconnect.disabled = true;
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
      begin.disabled = disconnect.disabled = false;
    }
  }
  begin.onclick = () => signIn();

  async function removed() {
    sessionStorage.removeItem(flowKey);
    picker.hidden = true;
    begin.hidden = false;
    await sync(true);
    message.textContent = "Library removed from Trailer Room.";
  }

  async function resume() {
    try {
      flow = sessionStorage.getItem(flowKey);
      if (!flow) {
        throw Error("Start a new Plex sign-in in this tab.");
      }
      begin.hidden = true;
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
      picker.hidden = false;
      message.textContent = result.servers.length ? "" : "No accessible Plex servers with secure connections were found.";
    } catch (error) {
      message.textContent = error.message;
      begin.hidden = false;
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
    picker.hidden = true;
    begin.hidden = false;
    message.textContent = "";
    begin.focus();
  };

  async function connect() {
    const body = {flow, server: server.value, library: library.value};
    server.disabled = library.disabled = save.disabled = disconnect.disabled = $("plexCancel").disabled = true;
    message.textContent = "Importing films…";
    try {
      await call("connect", body);
      sessionStorage.removeItem(flowKey);
      picker.hidden = true;
      begin.hidden = false;
      await sync(true);
      message.textContent = "Library connected.";
    } catch (error) {
      message.textContent = error.message;
    } finally {
      server.disabled = server.options.length < 2;
      library.disabled = library.options.length < 2;
      save.disabled = !library.value;
      disconnect.disabled = false;
      $("plexCancel").disabled = false;
    }
  }
  picker.onsubmit = event => {
    event.preventDefault();
    if (library.value) {
      connect();
    }
  };
  disconnect.onclick = async () => {
    if (!state || !confirm('Remove “' + state.name + '” from Trailer Room for everyone on this installation?')) {
      return;
    }
    const connection = state.connection;
    begin.disabled = disconnect.disabled = true;
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
      begin.disabled = disconnect.disabled = false;
    }
  };
  return {status, resume};
}
