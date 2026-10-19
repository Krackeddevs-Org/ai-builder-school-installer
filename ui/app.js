/* AI Builder School Setup — app logic.
   Talks to the Rust backend over Tauri IPC. Falls back to a demo mode when opened
   in a plain browser, so the UI can be previewed without building the shell. */

const invoke = (window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke)
  ? window.__TAURI__.core.invoke
  : null;

const DEMO = !invoke;
const BASE_URL = "https://litellm.rapidscreen.io/v1";
const PREF_KEY = "aibs.preferredModel";

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
    const row = el("div", "task");
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
    wrap.appendChild(row);
  });
  // overall badge
  const vals = order.map((id) => (state.tasks[id] || {}).status);
  const badge = $("envBadge");
  if (vals.some((v) => v === "failed")) { badge.className = "badge err"; badge.innerHTML = '<span>needs attention</span><span></span>'; }
  else if (vals.some((v) => v === "running")) { badge.className = "badge run"; badge.innerHTML = '<span>working</span><span></span>'; }
  else if (vals.every((v) => v === "done" || v === "skipped")) { badge.className = "badge ok"; badge.innerHTML = icon("check", 12) + "<span>ready</span>"; }
  else { badge.className = "badge idle"; badge.innerHTML = "<span>ready to install</span>"; }
  // progress bar
  const doneCount = vals.filter((v) => v === "done" || v === "skipped").length;
  $("progBar").style.width = Math.round((doneCount / order.length) * 100) + "%";
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
    report = { os: "Demo (browser preview)", steps: [
      { id: "vscode", label: "Visual Studio Code", status: "skipped", detail: "already installed — 1.104.0", command: null },
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
async function installAll() {
  $("btnInstall").disabled = true;
  $("btnRecheck").disabled = true;
  const order = ["vscode", "git", "node"];

  for (const id of order) {
    const t = state.tasks[id] || {};
    if (t.status === "skipped" || t.status === "done") { log("• " + (t.label || id) + " — already present, skipped"); continue; }
    if (t.status === "manual") { log("! " + (t.label || id) + " — needs a manual step", "er"); continue; }

    setTask(id, { status: "running", detail: "installing…" });
    renderTasks();
    log("→ installing " + (t.label || id));

    let res;
    if (DEMO) {
      await new Promise((r) => setTimeout(r, 900));
      res = { ok: true, status: "done", detail: "installed (demo)", command: t.command };
    } else {
      try { res = await invoke("install_tool", { id, dryRun: false }); }
      catch (e) { res = { ok: false, status: "failed", detail: String(e) }; }
    }
    setTask(id, { status: res.status, detail: res.detail });
    renderTasks();
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

  setTask("kilo", { status: "running", detail: "installing extension…" });
  renderTasks();
  log("→ installing the Kilo Code extension");
  let ext;
  if (DEMO) {
    await new Promise((r) => setTimeout(r, 800));
    ext = { ok: true, status: "done", detail: "Kilo Code installed (demo)" };
  } else {
    try { ext = await invoke("install_extension", { dryRun: false }); }
    catch (e) { ext = { ok: false, status: "failed", detail: String(e) }; }
  }
  setTask("kilo", { status: ext.status, detail: ext.detail });
  renderTasks();
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
  $("pingResult").textContent = res.message + " (" + res.latency_ms + " ms)";
  $("pingResult").style.color = "var(--ok)";
  badge.className = "badge ok"; badge.innerHTML = icon("check", 12) + "<span>connected</span>";
  $("btnApply").disabled = false;
  log("✓ " + res.message, "ok");
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

/* ── wire up ───────────────────────────────────────────────────────────── */
window.addEventListener("DOMContentLoaded", () => {
  if (window.Icons) window.Icons.hydrate(document);
  $("btnRecheck").addEventListener("click", () => { $("logWrap").classList.add("hidden"); $("logBox").innerHTML = ""; detect(); });
  $("btnInstall").addEventListener("click", installAll);
  $("btnPing").addEventListener("click", ping);
  $("btnApply").addEventListener("click", apply);
  $("btnSkipKey").addEventListener("click", skipKey);
  $("btnOpenCode").addEventListener("click", () => openCode());
  $("btnOpenFolder").addEventListener("click", openFolder);
  $("apiKey").addEventListener("keydown", (e) => { if (e.key === "Enter") ping(); });
  detect();
});