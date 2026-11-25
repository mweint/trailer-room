// Plex setup inside the Programming sheet: sign-in hand-off, server picker, a switch per library, connect
// and remove. The Plex group's Change and Remove links (programming.js) start these through the returned functions.
import {$, el, reveal} from "../dom.js";
import {plexCall as call} from "../api.js";

const flowKey = "trailer-room.plex-setup";
const removalKey = "trailer-room.plex-remove";

function options(select, prompt, entries = []) {
  select.replaceChildren(new Option(prompt, ""), ...entries.map(item => new Option(item.name, item.id)));
  select.disabled = !entries.length;
}

// A switch per film library on the chosen server; the ones already connected start switched on.
function libraryChoices(list, entries, connected, changed) {
  list.replaceChildren(...entries.map(item => {
    const label = el("label", "plex-library");
    const input = el("input");
    input.type = "checkbox";
    input.value = item.id;
    input.checked = connected.includes("plex-" + item.id);
    input.onchange = changed;
    label.append(el("span", "", item.name), input, el("span", "switch"));
    return label;
  }));
}

function chosen(list) {
  return Array.from(list.querySelectorAll("input:checked"), input => input.value);
}

// sync(force) reloads the collections after the libraries change.
export function plexPreferences(sync) {
  const picker = $("plexPicker");
  const server = $("plexServer");
  const libraries = $("plexLibraries");
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
    message.textContent = "Plex removed from Trailer Room.";
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
        message.textContent = "Removing Plex…";
        await call("disconnect", {flow, connection});
        await removed();
        return;
      }
      message.textContent = "Finding your servers…";
      const result = await call("servers", {flow});
      options(server, "Choose a server", result.servers);
      libraries.replaceChildren();
      reveal(picker, true);
      message.textContent = result.servers.length ? "" : "No accessible Plex servers with secure connections were found.";
    } catch (error) {
      message.textContent = error.message;
    }
  }

  server.onchange = async () => {
    const selected = server.value;
    libraries.replaceChildren();
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
      // Libraries already connected start switched on when this is the same server.
      const same = state && server.selectedOptions[0]?.text === state.server;
      libraryChoices(libraries, result.libraries, same ? state.libraries : [], () => {
        save.disabled = !chosen(libraries).length;
      });
      save.disabled = !chosen(libraries).length;
      message.textContent = result.libraries.length ? "" : "This server has no accessible film libraries.";
    } catch (error) {
      if (server.value === selected) {
        message.textContent = error.message;
      }
    }
  };
  $("plexCancel").onclick = () => {
    sessionStorage.removeItem(flowKey);
    flow = null;
    reveal(picker, false);
    message.textContent = "";
  };

  async function connect() {
    const body = {flow, server: server.value, library: chosen(libraries).join(",")};
    server.disabled = save.disabled = $("plexCancel").disabled = true;
    busy = true;
    message.textContent = "Importing films…";
    try {
      await call("connect", body);
      sessionStorage.removeItem(flowKey);
      reveal(picker, false);
      await sync(true);
      message.textContent = "Plex libraries updated.";
    } catch (error) {
      message.textContent = error.message;
    } finally {
      server.disabled = server.options.length < 2;
      save.disabled = !chosen(libraries).length;
      busy = false;
      $("plexCancel").disabled = false;
    }
  }
  picker.onsubmit = event => {
    event.preventDefault();
    if (chosen(libraries).length) {
      connect();
    }
  };
  async function remove() {
    if (busy || !state || !confirm('Remove Plex (' + state.server + ') from Trailer Room for everyone on this installation?')) {
      return;
    }
    const connection = state.connection;
    busy = true;
    message.textContent = "Removing Plex…";
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
