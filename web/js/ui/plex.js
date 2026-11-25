// Plex setup inside the Programming sheet: sign-in hand-off, server picker, a switch per library, connect
// and remove. The Plex group's Change and Remove links (programming.js) start these through the returned functions.
import {$, el, resize, reveal} from "../dom.js";
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

// The message line shows only work in progress and errors. A finished change shows itself in the source list,
// so the line clears.
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

  // The message line grows and shrinks with its text, like any region that appears in place.
  function say(text) {
    if (message.textContent !== text) {
      resize(message, () => {
        message.textContent = text;
      }, !!text, true);
    }
  }

  function status(source) {
    state = source;
  }
  status(null);

  async function signIn(removeConnection = "") {
    if (busy) {
      return;
    }
    busy = true;
    say("Opening Plex sign-in…");
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

  // Signed in: choose any server. From the connecting browser without sign-in: the connected server only.
  function signedIn(yes) {
    $("plexServerField").hidden = !yes;
    $("plexCurrent").hidden = yes;
  }

  function offer(entries) {
    const connected = state && (flow ? server.selectedOptions[0]?.text === state.server : true) ? state.libraries : [];
    libraryChoices(libraries, entries, connected, () => {
      save.disabled = !chosen(libraries).length;
    });
    save.disabled = !chosen(libraries).length;
    say(entries.length ? "" : "This server has no accessible film libraries.");
  }

  // Change: the browser that connected Plex lists the server's libraries straight away; anywhere else signs in.
  async function change() {
    if (busy) {
      return;
    }
    if (!state) {
      return signIn();
    }
    say("Finding libraries…");
    try {
      const result = await call("manage");
      if (result.signInRequired) {
        return signIn();
      }
      flow = null;
      $("plexCurrentName").textContent = result.server;
      signedIn(false);
      offer(result.libraries);
      reveal(picker, true);
    } catch (error) {
      say(error.message);
    }
  }
  $("plexOtherServer").onclick = () => signIn();

  async function removed() {
    sessionStorage.removeItem(flowKey);
    reveal(picker, false);
    await sync(true);
    say("");
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
        say("Removing Plex…");
        await call("disconnect", {flow, connection});
        await removed();
        return;
      }
      say("Finding your servers…");
      const result = await call("servers", {flow});
      signedIn(true);
      options(server, "Choose a server", result.servers);
      libraries.replaceChildren();
      reveal(picker, true);
      say(result.servers.length ? "" : "No accessible Plex servers with secure connections were found.");
      // With a single server there is nothing to choose: take it and list its libraries.
      if (result.servers.length === 1) {
        server.value = result.servers[0].id;
        server.onchange();
      }
    } catch (error) {
      say(error.message);
    }
  }

  server.onchange = async () => {
    const selected = server.value;
    libraries.replaceChildren();
    save.disabled = true;
    say("");
    if (!selected) {
      return;
    }
    say("Finding libraries…");
    try {
      const result = await call("libraries", {flow, server: selected});
      if (server.value !== selected) {
        return;
      }
      offer(result.libraries);
    } catch (error) {
      if (server.value === selected) {
        say(error.message);
      }
    }
  };
  $("plexCancel").onclick = () => {
    sessionStorage.removeItem(flowKey);
    flow = null;
    reveal(picker, false);
    say("");
  };

  async function connect() {
    const library = chosen(libraries).join(",");
    const body = flow ? {flow, server: server.value, library} : {library};
    server.disabled = save.disabled = $("plexCancel").disabled = true;
    busy = true;
    say("Importing films…");
    try {
      const result = await call("connect", body);
      if (result.signInRequired) {
        return await signIn();
      }
      sessionStorage.removeItem(flowKey);
      reveal(picker, false);
      await sync(true);
      say("");
    } catch (error) {
      say(error.message);
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
    say("Removing Plex…");
    try {
      const result = await call("disconnect", {connection, ...(picker.hidden ? {} : {flow})});
      if (result.signInRequired) {
        return await signIn(connection);
      }
      await removed();
    } catch (error) {
      say(error.message);
    } finally {
      busy = false;
    }
  }
  return {status, resume, start: change, remove};
}
