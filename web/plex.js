const $ = id => document.getElementById(id);
const flowKey = "trailer-room.plex-setup";

async function call(action, body = {}) {
  const response = await fetch("/api/plex/" + action, {
    method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(body)
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Couldn’t reach Plex.");
  return result;
}

function options(select, prompt, entries = []) {
  select.replaceChildren(new Option(prompt, ""), ...entries.map(item => new Option(item.name, item.id)));
  select.disabled = !entries.length;
}

export function plexPreferences(sync) {
  const begin = $("plexBegin"), picker = $("plexPicker"), server = $("plexServer"), library = $("plexLibrary");
  const save = $("plexSave"), disconnect = $("plexDisconnect"), message = $("plexMessage");
  let state, flow;
  function status(source) {
    state = source;
    $("plexSummary").textContent = state ? state.server + " / " + state.name : "Add films from a library you choose.";
    begin.textContent = state ? "Manage Plex connection" : "Connect Plex";
    disconnect.hidden = !state;
  }
  status(null);
  begin.onclick = async () => {
    begin.disabled = true;
    message.textContent = "Opening Plex sign-in…";
    try {
      const result = await call("begin");
      sessionStorage.setItem(flowKey, result.flow);
      location.assign(result.url);
    } catch (error) { message.textContent = error.message; begin.disabled = false; }
  };
  async function resume() {
    try {
      flow = sessionStorage.getItem(flowKey);
      if (!flow) throw Error("Start a new Plex sign-in in this tab.");
      begin.hidden = true;
      message.textContent = "Finding your servers…";
      const result = await call("servers", {flow});
      options(server, "Choose a server", result.servers);
      options(library, "Choose a library");
      picker.hidden = false;
      message.textContent = result.servers.length ? "" : "No accessible Plex servers with secure connections were found.";
    } catch (error) { message.textContent = error.message; begin.hidden = false; }
  }
  server.onchange = async () => {
    const selected = server.value;
    options(library, "Choose a library");
    save.disabled = true;
    message.textContent = "";
    if (!selected) return;
    message.textContent = "Finding libraries…";
    try {
      const result = await call("libraries", {flow, server: selected});
      if (server.value !== selected) return;
      options(library, "Choose a library", result.libraries);
      message.textContent = result.libraries.length ? "" : "This server has no accessible film libraries.";
    } catch (error) { if (server.value === selected) message.textContent = error.message; }
  };
  library.onchange = () => { save.disabled = !library.value; };
  $("plexCancel").onclick = () => {
    sessionStorage.removeItem(flowKey);
    flow = null;
    picker.hidden = true;
    begin.hidden = false;
    message.textContent = "";
    begin.focus();
  };
  async function finish(action) {
    const body = {flow, server: server.value, library: library.value};
    server.disabled = library.disabled = save.disabled = disconnect.disabled = $("plexCancel").disabled = true;
    message.textContent = action === "connect" ? "Importing films…" : "Disconnecting…";
    try {
      await call(action, body);
      sessionStorage.removeItem(flowKey);
      picker.hidden = true;
      begin.hidden = false;
      await sync(true);
      message.textContent = action === "connect" ? "Library connected." : "Library disconnected.";
    } catch (error) { message.textContent = error.message; }
    finally {
      server.disabled = server.options.length < 2;
      library.disabled = library.options.length < 2;
      save.disabled = !library.value;
      disconnect.disabled = false;
      $("plexCancel").disabled = false;
    }
  }
  picker.onsubmit = event => { event.preventDefault(); if (library.value) finish("connect"); };
  disconnect.onclick = () => finish("disconnect");
  return {status, resume};
}
