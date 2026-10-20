/* AI Builder School Setup — app logic.
   Talks to the Rust backend over Tauri IPC. Falls back to a demo mode when opened
   in a plain browser, so the UI can be previewed without building the shell. */

const invoke = (window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke)
  ? window.__TAURI__.core.invoke
  : null;

/* External links must be handed to the OS. A Tauri webview refuses to navigate away from
 * the app bundle, so a plain <a href="https://..."> click does nothing at all — the student
 * clicks and the app appears frozen. Route every external link through the opener plugin. */
const openUrl = (() => {
  const plugin = window.__TAURI__ && window.__TAURI__.opener && window.__TAURI__.opener.openUrl;
  if (plugin) return plugin;
  if (invoke) return (url) => invoke("plugin:opener|open_url", { url });
  // Browser preview: a normal tab is fine.
  return (url) => Promise.resolve(window.open(url, "_blank", "noopener"));
})();

/* Live installer output arrives as events from the Rust side while the install command is
 * still running. */
const listen = (window.__TAURI__ && window.__TAURI__.event && window.__TAURI__.event.listen) || null;

const DEMO = !invoke;
const BASE_URL = "https://litellm.rapidscreen.io/v1";
const PREF_KEY = "aibs.preferredModel";
const PROGRESS_EVENT = "install-progress";
const PROGRESS_FLUSH_MS = 100;   // a fast-redrawing installer must not flood the webview
const HINT_AFTER_MS = 20000;
const HINT_TEXT = "This can take a few minutes — the installer is still working.";

const $ = (id) => document.getElementById(id);
const el = (tag, cls) => { const n = document.createElement(tag); if (cls) n.className = cls; return n; };
const icon = (name, size) => (window.Icons ? window.Icons.svg(name, size || 18) : "");

/* ── state ─────────────────────────────────────────────────────────────── */
const state = {
  report: null,
  tasks: {},          // id -> {status, detail, command}
  models: [],
  selectedModel: null,
  connected: false,
  apiKey: "",
  installed: [],
  skippedKey: false,
};

/* ── logging ───────────────────────────────────────────────────────────── */
function log(msg, kind) {
  const box = $("logBox");
  $("logWrap").classList.remove("hidden");
  const line = el("div", kind || "");
  line.textContent = msg;
  box.appendChild(line);
  box.scrollTop = box.scrollHeight;
}

/* ── live installer output ─────────────────────────────────────────────── */
let pending = [];
let flushTimer = null;
let liveTimer = null;

function onProgress(p) {
  // Redraws (progress bars) only matter as the latest one, so a burst collapses to one line.
  const last = pending[pending.length - 1];
  if (p.transient && last && last.transient && last.id === p.id) pending[pending.length - 1] = p;
  else pending.push(p);
  if (!flushTimer) flushTimer = setTimeout(flushProgress, PROGRESS_FLUSH_MS);
}

/* Redraws show under the running step; everything else also joins the log. */
function flushProgress() {
  clearTimeout(flushTimer);
  flushTimer = null;
  const batch = pending;
  pending = [];
  batch.forEach(({ id, line, transient }) => {
    if (!transient) log("   " + line);
    const t = state.tasks[id];
    if (t && t.status === "running") t.line = line;
  });
  if (batch.length) tickLive();
}

function fmtElapsed(ms) {
  const s = Math.floor(ms / 1000);
  return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
}

/* Updates the running row in place; rebuilding it would restart the spinner every tick. */
function tickLive() {
  document.querySelectorAll("#taskRows .task.running").forEach((row) => {
    const t = state.tasks[row.dataset.id];
    const live = row.querySelector(".live");
    if (!t || !t.startedAt || !live) return;
    const ms = Date.now() - t.startedAt;
    row.querySelector(".meta").textContent = t.detail + " " + fmtElapsed(ms);
    live.querySelector(".line").textContent = t.line || "";
    live.querySelector(".hint").classList.toggle("hidden", ms < HINT_AFTER_MS);
  });
}

function syncLiveTimer() {
  const timing = Object.values(state.tasks).some((t) => t.status === "running" && t.startedAt);
  if (timing && !liveTimer) liveTimer = setInterval(tickLive, 1000);
  if (!timing && liveTimer) { clearInterval(liveTimer); liveTimer = null; }
}

/* ── theme ─────────────────────────────────────────────────────────────── */
function applyTheme(mode) {
  const dark = mode === "dark" ||
    (mode === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.querySelectorAll("#themeToggle button").forEach((b) => {
    b.classList.toggle("on", b.dataset.t === mode);
  });
  try { localStorage.setItem("aibs.theme", mode); } catch (e) {}
}
document.querySelectorAll("#themeToggle button").forEach((b) => {
  b.addEventListener("click", () => applyTheme(b.dataset.t));
});
applyTheme((() => { try { return localStorage.getItem("aibs.theme") || "system"; } catch (e) { return "system"; } })());
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  const cur = document.querySelector("#themeToggle button.on");
  if (cur && cur.dataset.t === "system") applyTheme("system");
});

/* ── rail rendering ────────────────────────────────────────────────────── */
const STEP_ICON = { vscode: "code", git: "git", node: "node", kilo: "rocket", api: "key" };

function renderRail() {
  const list = $("stepList");
  list.innerHTML = "";
  const order = ["vscode", "git", "node", "kilo", "api"];
  order.forEach((id) => {
    const t = state.tasks[id] || { status: "idle", detail: "" };
    const li = el("li", "step " + t.status);
    const mark = el("span", "mark");
    // The mark shows STATUS while the row keeps its identity icon in the label.
    if (t.status === "done") mark.innerHTML = icon("check", 13);
    else if (t.status === "skipped") mark.innerHTML = icon("dash", 13);
    else if (t.status === "running") mark.innerHTML = '<span class="spin" style="border-color:rgba(11,26,74,.3);border-top-color:#0b1a4a"></span>';
    else if (t.status === "failed") mark.innerHTML = icon("error", 13);
    else mark.innerHTML = icon("circle", 13);
    const txt = el("span", "txt");
    const nm = el("span", "name");
    // Identity icon inline with each step name, so the list reads as the tools it installs.
    nm.innerHTML = icon(STEP_ICON[id] || "circle", 14) + "<span>" + (t.label || id) + "</span>";
    const sb = el("span", "sub");
    sb.textContent = t.detail || "";
    sb.title = t.detail || "";
    txt.appendChild(nm); txt.appendChild(sb);
    li.appendChild(mark); li.appendChild(txt);
    if (t.status === "active") li.classList.add("fade");
    list.appendChild(li);
  });
}

function setTask(id, patch) {
  state.tasks[id] = Object.assign({}, state.tasks[id] || {}, patch);
  renderRail();
}

/* ── task rows in the main panel ───────────────────────────────────────── */
function renderTasks() {
  const wrap = $("taskRows");
  wrap.innerHTML = "";
  const order = ["vscode", "git", "node", "kilo"];
  order.forEach((id) => {
    const t = state.tasks[id] || { status: "idle" };
    const row = el("div", "task" + (t.status === "running" ? " running" : ""));
    row.dataset.id = id;
    const tick = el("span", "tick " + (t.status === "done" ? "done" : t.status === "skipped" ? "skip" : t.status === "running" ? "run" : t.status === "failed" ? "err" : "idle"));
    if (t.status === "done") tick.innerHTML = icon("check", 12);
    else if (t.status === "skipped") tick.innerHTML = icon("skip", 12);
    else if (t.status === "failed") tick.innerHTML = icon("error", 12);
    else if (t.status === "running") tick.innerHTML = '<span class="spin"></span>';
    else tick.innerHTML = icon("circle", 11);
    const nm = el("span", "name"); nm.textContent = t.label || id;
    const meta = el("span", "meta"); meta.textContent = t.detail || "";
    meta.title = t.detail || "";
    row.appendChild(tick); row.appendChild(nm); row.appendChild(meta);
    if (t.status === "running" && t.startedAt) {
      const live = el("div", "live");
      const hint = el("span", "hint hidden");
      hint.textContent = HINT_TEXT;
      live.appendChild(el("span", "line"));
      live.appendChild(hint);
      row.appendChild(live);
    }
    wrap.appendChild(row);
  });
  // overall badge
  const vals = order.map((id) => (state.tasks[id] || {}).status);
  const badge = $("envBadge");
  if (vals.some((v) => v === "failed")) { badge.className = "badge err"; badge.innerHTML = '<span>needs attention</span><span></span>'; }
  else if (vals.some((v) => v === "running")) { badge.className = "badge run"; badge.innerHTML = '<span>working</span><span></span>'; }
  else if (vals.every((v) => v === "done" || v === "skipped")) { badge.className = "badge ok"; badge.innerHTML = icon("check", 12) + "<span>ready</span>"; }
  else { badge.className = "badge idle"; badge.innerHTML = "<span>ready to install</span>"; }
  // progress bar: a running step counts as half done, and the bar shimmers while work is live
  const doneCount = vals.filter((v) => v === "done" || v === "skipped").length;
  const runningCount = vals.filter((v) => v === "running").length;
  $("progBar").style.width = Math.round(((doneCount + runningCount / 2) / order.length) * 100) + "%";
  $("progBar").parentElement.classList.toggle("working", runningCount > 0);
  syncLiveTimer();
  tickLive();
}

/* ── detection ─────────────────────────────────────────────────────────── */
async function detect() {
  setTask("vscode", { status: "running", detail: "checking…", label: "Visual Studio Code" });
  setTask("git", { status: "running", detail: "checking…", label: "Git" });
  setTask("node", { status: "running", detail: "checking…", label: "Node.js LTS" });
  setTask("kilo", { status: "idle", detail: "pending", label: "Kilo Code" });
  setTask("api", { status: "idle", detail: "", label: "API key" });
  renderTasks();

  let report;
  if (DEMO) {
    report = { os: "Linux (Arch)", steps: [
      { id: "vscode", label: "Visual Studio Code", status: "skipped", detail: "already installed — 1.131.0", command: null },
      { id: "git", label: "Git", status: "skipped", detail: "already installed — git version 2.56.0", command: null },
      { id: "node", label: "Node.js LTS", status: "pending", detail: "needs installing", command: "sudo pacman -S --needed --noconfirm nodejs" },
      { id: "kilo", label: "Kilo Code", status: "pending", detail: "will install", command: "/usr/bin/code --install-extension kilocode.Kilo-Code --force" },
      { id: "api", label: "API key", status: "pending", detail: BASE_URL, command: null },
    ]};
    await new Promise((r) => setTimeout(r, 350));
  } else {
    report = await invoke("detect");
  }

  state.report = report;
  $("osLabel").textContent = report.os;
  (report.steps || []).forEach((s) => {
    setTask(s.id, { label: s.label, status: s.status === "pending" ? "idle" : s.status, detail: s.detail, command: s.command });
    state.tasks[s.id].baseStatus = s.status;
  });
  renderTasks();
  renderManual();
  $("footHint").textContent = report.os;
}

function renderManual() {
  const missing = Object.entries(state.tasks)
    .filter(([id, t]) => ["vscode", "git", "node"].includes(id) && t.status === "manual")
    .map(([, t]) => t.detail);
  const box = $("manualBoxWrap");
  if (missing.length) {
    box.classList.remove("hidden");
    $("manualBox").textContent = missing.join(" ");
  } else {
    box.classList.add("hidden");
  }
}

/* ── install ───────────────────────────────────────────────────────────── */
function startStep(id, detail) {
  setTask(id, { status: "running", detail, startedAt: Date.now(), line: "" });
  renderTasks();
}

function finishStep(id, res) {
  flushProgress();   // output that arrived before the result belongs above it in the log
  setTask(id, { status: res.status, detail: res.detail, startedAt: null, line: "" });
  renderTasks();
}

/* Browser preview has no installer to stream from, so feed the same path some fake output. */
const DEMO_OUTPUT = {
  kilo: [["Resolving kilocode.Kilo-Code…", false], ["Downloading extension… 30%", true], ["Downloading extension… 80%", true], ["Installing extension…", false]],
  tool: [["Resolving packages…", false], ["Downloading… 20%", true], ["Downloading… 65%", true], ["Installing…", false]],
};
async function demoInstall(id, ms) {
  const lines = DEMO_OUTPUT[id] || DEMO_OUTPUT.tool;
  for (const [line, transient] of lines) {
    await new Promise((r) => setTimeout(r, ms / lines.length));
    onProgress({ id, line, transient });
  }
}

async function installAll() {
  $("btnInstall").disabled = true;
  $("btnRecheck").disabled = true;
  const order = ["vscode", "git", "node"];

  for (const id of order) {
    const t = state.tasks[id] || {};
    if (t.status === "skipped" || t.status === "done") { log("• " + (t.label || id) + " — already present, skipped"); continue; }
    if (t.status === "manual") { log("! " + (t.label || id) + " — needs a manual step", "er"); continue; }

    startStep(id, "installing…");
    log("→ installing " + (t.label || id));

    let res;
    if (DEMO) {
      await demoInstall(id, 900);
      res = { ok: true, status: "done", detail: "installed", command: t.command };
    } else {
      try { res = await invoke("install_tool", { id, dryRun: false }); }
      catch (e) { res = { ok: false, status: "failed", detail: String(e) }; }
    }
    finishStep(id, res);
    log((res.ok ? "✓ " : "✗ ") + (t.label || id) + " — " + res.detail, res.ok ? "ok" : "er");
    if (res.status === "manual") renderManual();
  }

  // VS Code must exist before the extension can be installed.
  const vs = state.tasks.vscode || {};
  if (vs.status === "failed" || vs.status === "manual") {
    log("! Skipping the Kilo Code extension until VS Code is available", "er");
    setTask("kilo", { status: "failed", detail: "waiting for VS Code" });
    renderTasks();
    finishEnvPhase(false);
    return;
  }

  startStep("kilo", "installing extension…");
  log("→ installing the Kilo Code extension");
  let ext;
  if (DEMO) {
    await demoInstall("kilo", 800);
    ext = { ok: true, status: "done", detail: "Kilo Code installed" };
  } else {
    try { ext = await invoke("install_extension", { dryRun: false }); }
    catch (e) { ext = { ok: false, status: "failed", detail: String(e) }; }
  }
  finishStep("kilo", ext);
  log((ext.ok ? "✓ " : "✗ ") + "Kilo Code — " + ext.detail, ext.ok ? "ok" : "er");

  finishEnvPhase(ext.ok);
}

function finishEnvPhase(ok) {
  $("btnInstall").disabled = false;
  $("btnRecheck").disabled = false;
  if (ok) {
    setTimeout(() => showView("api"), 420);
  } else {
    log("! Something did not complete. You can re-check or continue anyway.", "er");
    $("btnInstall").innerHTML = icon("rocket", 16) + "Continue to API key";
    $("btnInstall").onclick = () => showView("api");
  }
}

/* ── views ─────────────────────────────────────────────────────────────── */
const VIEWS = {
  env:  { el: "viewEnv",  eyebrow: "Step 1 of 2", title: "Setting up your machine",
          lede: "We check what you already have before installing anything — existing tools are left untouched." },
  api:  { el: "viewApi",  eyebrow: "Step 2 of 2", title: "Connect your API key",
          lede: "Paste your AI Builder School key, or skip it and use Kilo's free models instead." },
  done: { el: "viewDone", eyebrow: "All done", title: "Setup complete",
          lede: "Everything is installed and configured. Open VS Code and start building." },
};
function showView(name) {
  Object.values(VIEWS).forEach((v) => $(v.el).classList.add("hidden"));
  const v = VIEWS[name];
  $(v.el).classList.remove("hidden");
  $(v.el).classList.add("fade");
  $("eyebrow").textContent = v.eyebrow;
  $("title").textContent = v.title;
  $("lede").textContent = v.lede;
  if (name === "api") {
    setTask("api", { status: "active", detail: "waiting for your key" });
    renderRail();
    setTimeout(() => $("apiKey").focus(), 120);
  }
}

/* ── API connect ───────────────────────────────────────────────────────── */
async function ping() {
  const key = $("apiKey").value.trim();
  const badge = $("apiBadge");
  $("fKey").classList.remove("ok", "err");

  if (!key) {
    $("fKey").classList.add("err");
    $("pingResult").textContent = "Enter your API key first.";
    $("pingResult").style.color = "var(--danger)";
    badge.className = "badge err"; badge.innerHTML = "<span>no key</span>";
    return;
  }

  $("btnPing").disabled = true;
  $("pingResult").textContent = "Contacting the gateway…";
  $("pingResult").style.color = "var(--fg-faint)";
  badge.className = "badge run"; badge.innerHTML = "<span>testing</span>";

  let res;
  if (DEMO) {
    await new Promise((r) => setTimeout(r, 800));
    if (!/^sk-/.test(key)) {
      res = { ok: false, message: "That API key was rejected (401). Check you copied the whole key from your KrackedDevs profile.", models: [] };
    } else {
      const demoModels = ["deepseek-v4.1-flash","gpt-5.4","gpt-5.4-mini","gpt-5.4-nano","gpt-5.5","gpt-5.6-luna","gpt-5.6-sol","gpt-5.6-terra","gpt-6-astra","gpt-6-luna","gpt-6-sol","gpt-image-2"];
      // Mirror the backend's choose_default(): honour the remembered model when the
      // gateway still offers it, else fall back to deepseek-v4.1-flash.
      const preferred = (() => { try { return localStorage.getItem(PREF_KEY); } catch (e) { return null; } })();
      const pick = (preferred && demoModels.includes(preferred)) ? preferred
        : (demoModels.includes("deepseek-v4.1-flash") ? "deepseek-v4.1-flash" : demoModels[0]);
      res = {
        ok: true, latency_ms: 412, default_model: pick,
        message: "Connected — " + demoModels.length + " models available.",
        models: demoModels,
      };
    }
  } else {
    const preferred = localStorage.getItem(PREF_KEY) || null;
    try { res = await invoke("verify_key", { apiKey: key, baseUrl: null, preferred }); }
    catch (e) { res = { ok: false, message: String(e), models: [] }; }
  }

  $("btnPing").disabled = false;

  if (!res.ok) {
    $("fKey").classList.add("err");
    $("pingResult").textContent = res.message;
    $("pingResult").style.color = "var(--danger)";
    badge.className = "badge err"; badge.innerHTML = "<span>rejected</span>";
    $("modelWrap").classList.add("hidden");
    $("btnApply").disabled = true;
    state.connected = false;
    log("✗ " + res.message, "er");
    return;
  }

  state.connected = true;
  state.apiKey = key;
  state.models = res.models || [];
  state.selectedModel = res.default_model || state.models[0] || null;

  $("fKey").classList.add("ok");
  // Defensive: never render "undefined" at a student, whatever the backend returns.
  const msg = typeof res.message === "string" && res.message ? res.message : "Connected.";
  const ms = Number.isFinite(Number(res.latency_ms)) ? " (" + res.latency_ms + " ms)" : "";
  $("pingResult").textContent = msg + ms;
  $("pingResult").style.color = "var(--ok)";
  badge.className = "badge ok"; badge.innerHTML = icon("check", 12) + "<span>connected</span>";
  $("btnApply").disabled = false;
  log("✓ " + msg, "ok");
  renderModels();
}

function renderModels() {
  const grid = $("modelGrid");
  grid.innerHTML = "";
  state.models.forEach((m) => {
    const card = el("button", "model" + (m === state.selectedModel ? " on" : ""));
    card.type = "button";
    const dot = el("span", "dot");
    const nm = el("span", "nm"); nm.textContent = m; nm.title = m;
    card.appendChild(dot); card.appendChild(nm);
    if (m === "deepseek-v4.1-flash") {
      const rec = el("span", "rec"); rec.textContent = "default"; card.appendChild(rec);
    }
    card.addEventListener("click", () => {
      state.selectedModel = m;
      try { localStorage.setItem(PREF_KEY, m); } catch (e) {}
      renderModels();
      log("• default model set to " + m);
    });
    grid.appendChild(card);
  });
  $("modelWrap").classList.remove("hidden");
}

/* ── apply ─────────────────────────────────────────────────────────────── */
async function apply() {
  $("btnApply").disabled = true;
  $("btnSkipKey").disabled = true;
  log("→ writing Kilo Code configuration");

  let res;
  if (DEMO) {
    await new Promise((r) => setTimeout(r, 500));
    res = { ok: true, log: [
      "Wrote ~/.config/kilo/kilo.jsonc",
      "Stored credential in ~/.local/share/kilo/auth.json",
      "Set AIBS_API_KEY in ~/.bashrc",
      "Default model set to aibs/" + (state.selectedModel || "deepseek-v4.1-flash"),
    ], fatal: null };
  } else {
    try {
      res = await invoke("apply_config", {
        apiKey: state.apiKey,
        models: state.models,
        defaultModel: state.selectedModel,
        useEnv: false,
        dryRun: false,
      });
    } catch (e) { res = { ok: false, log: [], fatal: String(e) }; }
  }

  (res.log || []).forEach((l) => log("✓ " + l, "ok"));
  if (!res.ok) {
    log("✗ " + (res.fatal || "could not apply configuration"), "er");
    $("btnApply").disabled = false;
    $("btnSkipKey").disabled = false;
    return;
  }
  setTask("api", { status: "done", detail: "connected — default " + (state.selectedModel || "?") });
  renderRail();
  showDone(false);
}

async function skipKey() {
  state.skippedKey = true;
  $("btnApply").disabled = true;
  $("btnSkipKey").disabled = true;
  log("• Skipped the API key — you can use Kilo's free models");
  let res;
  if (DEMO) {
    await new Promise((r) => setTimeout(r, 300));
    res = { ok: true, log: [] };
  } else {
    try { res = await invoke("apply_config", { apiKey: null, models: [], defaultModel: null, useEnv: false, dryRun: false }); }
    catch (e) { res = { ok: false, fatal: String(e) }; }
  }
  (res.log || []).forEach((l) => log("✓ " + l, "ok"));
  setTask("api", { status: "skipped", detail: "using Kilo's free models" });
  renderRail();
  showDone(true);
}

function showDone(skipped) {
  const rows = [];
  const add = (iconName, status, label, detail) => {
    const t = el("div", "task");
    const tick = el("span", "tick " + status);
    tick.innerHTML = icon(iconName, 12);
    const nm = el("span", "name"); nm.textContent = label;
    const meta = el("span", "meta"); meta.textContent = detail || "";
    t.appendChild(tick); t.appendChild(nm); t.appendChild(meta);
    rows.push(t);
  };
  const vs = state.tasks.vscode || {}; const gi = state.tasks.git || {}; const no = state.tasks.node || {};
  add("check", "done", "Visual Studio Code", vs.detail || "installed");
  add("check", "done", "Git", gi.detail || "installed");
  add("check", "done", "Node.js LTS", no.detail || "installed");
  add("check", "done", "Kilo Code extension", (state.tasks.kilo || {}).detail || "installed");
  if (skipped) add("dash", "skip", "API key", "skipped — using Kilo's free models");
  else add("check", "done", "API key", "default model: " + (state.selectedModel || "deepseek-v4.1-flash"));

  const wrap = $("doneSummary");
  wrap.innerHTML = "";
  rows.forEach((r) => wrap.appendChild(r));

  setTask("api", state.tasks.api || { status: "done", detail: "" });
  renderRail();
  showView("done");
}

/* ── open VS Code ──────────────────────────────────────────────────────── */
async function openCode(folder) {
  log("→ opening VS Code");
  let res;
  if (DEMO) { res = { ok: true, detail: "Opened VS Code (demo)" }; }
  else {
    try { res = await invoke("open_vscode", { folder: folder || null }); }
    catch (e) { res = { ok: false, detail: String(e) }; }
  }
  log((res.ok ? "✓ " : "✗ ") + res.detail, res.ok ? "ok" : "er");
}
async function openFolder() {
  // In the shell we let the user type a path; a native dialog needs the dialog plugin.
  const p = window.prompt("Path to your project folder:");
  if (p && p.trim()) openCode(p.trim());
}

/* ── external links ────────────────────────────────────────────────────── */

/** Send a URL to the OS browser. Falls back to copy-to-clipboard messaging if that fails,
 *  so the student is never left with a dead click and no explanation.
 *
 *  Guarded against re-entry so one click can never open two tabs. The window is short
 *  (250ms) and keyed on the URL, because two openers firing for the SAME click happen
 *  within a few milliseconds of each other, whereas a genuine second click by the user is
 *  far slower. A longer window would swallow real repeat clicks. */
let lastOpen = { url: "", at: 0 };
async function goTo(url, label) {
  const now = Date.now();
  if (lastOpen.url === url && now - lastOpen.at < 250) return; // same click, different opener
  lastOpen = { url, at: now };

  try {
    await openUrl(url);
    log("→ opened " + (label || url) + " in your browser");
  } catch (e) {
    // Last resort: put it on the clipboard and say so, rather than failing silently.
    let copied = false;
    try {
      await navigator.clipboard.writeText(url);
      copied = true;
    } catch (_) { /* clipboard may be unavailable */ }
    log(
      copied
        ? "! couldn't open the browser — link copied to clipboard: " + url
        : "! couldn't open the browser. The link is: " + url,
      "er"
    );
  }
}

/** Intercept every external <a> click. In the webview these do nothing by default. */
function wireExternalLinks(root) {
  (root || document).querySelectorAll('a[href^="http"]').forEach((a) => {
    if (a.dataset.wired === "1") return;
    a.dataset.wired = "1";
    a.addEventListener("click", (ev) => {
      ev.preventDefault();
      goTo(a.getAttribute("href"), a.textContent.trim());
    });
  });
}

/* ── click feedback ────────────────────────────────────────────────────── */

/** Tauri swallows native `:active` on some Linux/WebKit builds, so a press can look like
 *  nothing happened and students click again. We drive a visible pressed state ourselves
 *  and disable the control while its work is in flight. */
function wireButtonFeedback(root) {
  (root || document).querySelectorAll("button").forEach((btn) => {
    if (btn.dataset.fb === "1") return;
    btn.dataset.fb = "1";

    const press = () => btn.classList.add("pressed");
    const release = () => btn.classList.remove("pressed");

    // Pointer events cover mouse, touch and pen. Keyboard needs its own handling.
    btn.addEventListener("pointerdown", press);
    btn.addEventListener("pointerup", release);
    btn.addEventListener("pointerleave", release);
    btn.addEventListener("pointercancel", release);
    btn.addEventListener("keydown", (e) => {
      if (e.key === " " || e.key === "Enter") press();
    });
    btn.addEventListener("keyup", release);
    btn.addEventListener("blur", release);

    // A ripple gives immediate feedback even when the work itself is quick.
    btn.addEventListener("pointerdown", (e) => {
      const r = btn.getBoundingClientRect();
      const ripple = document.createElement("span");
      ripple.className = "ripple";
      const size = Math.max(r.width, r.height) * 2;
      ripple.style.width = ripple.style.height = size + "px";
      ripple.style.left = (e.clientX - r.left - size / 2) + "px";
      ripple.style.top = (e.clientY - r.top - size / 2) + "px";
      btn.appendChild(ripple);
      setTimeout(() => ripple.remove(), 520);
    });
  });
}

/** Wrap an async handler so the button shows a busy state and cannot be double-fired.
 *
 *  Two guards, because they cover different failures:
 *  - a synchronous latch set the instant the click lands, which closes the window between
 *    a fast handler resolving and the next click arriving;
 *  - `disabled` during the work, which stops keyboard and repeat clicks too.
 *  The latch is released on a microtask after the handler settles so a genuinely fast
 *  action still cannot be re-entered by a double-click. */
function busy(btn, fn) {
  let running = false;
  return async (...args) => {
    if (running || btn.disabled) return;
    running = true;
    btn.classList.add("busy");
    if (!btn.querySelector(".spinner")) {
      const s = document.createElement("span");
      s.className = "spinner";
      btn.appendChild(s);
    }
    try {
      await fn(...args);
    } finally {
      // Hold the latch through the current task, then release.
      await new Promise((r) => setTimeout(r, 180));
      running = false;
      btn.classList.remove("busy");
      const sp = btn.querySelector(".spinner");
      if (sp) sp.remove();
    }
  };
}

/* ── wire up ───────────────────────────────────────────────────────────── */
window.addEventListener("DOMContentLoaded", () => {
  if (window.Icons) window.Icons.hydrate(document);
  wireExternalLinks(document);
  wireButtonFeedback(document);

  $("btnRecheck").addEventListener("click", busy($("btnRecheck"), () => {
    $("logWrap").classList.add("hidden");
    $("logBox").innerHTML = "";
    return detect();
  }));
  $("btnInstall").addEventListener("click", busy($("btnInstall"), installAll));
  $("btnPing").addEventListener("click", busy($("btnPing"), ping));
  $("btnApply").addEventListener("click", busy($("btnApply"), apply));
  $("btnSkipKey").addEventListener("click", busy($("btnSkipKey"), skipKey));
  $("btnOpenCode").addEventListener("click", busy($("btnOpenCode"), () => openCode()));
  $("btnOpenFolder").addEventListener("click", busy($("btnOpenFolder"), openFolder));
  $("apiKey").addEventListener("keydown", (e) => { if (e.key === "Enter") ping(); });
  if (listen) listen(PROGRESS_EVENT, (ev) => onProgress(ev.payload));
  detect();
});