/* Verifies the live progress shown while "Install everything" runs.
 *
 * Why this exists: a multi-minute winget/brew run used to look frozen. The backend now
 * streams the installer's output as `install-progress` events, and the UI turns them into a
 * moving bar, a latest-line readout under the running step, an elapsed timer and a calm hint.
 *
 * Runs the real ui/index.html with a fake Tauri bridge (invoke + event.listen) and a fake
 * clock, so a "42 second" install takes no real time. Install commands stay pending until
 * the test resolves them, which is what lets us look at the UI mid-install.
 *
 * Usage: node tests/install-progress.test.mjs
 */

import { chromium } from "playwright";
import path from "path";
import fs from "fs";

const ROOT = path.resolve(import.meta.dirname, "..");
const PAGE = "file://" + path.join(ROOT, "ui", "index.html");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0;
let fail = 0;
const check = (name, ok, extra) => {
  if (ok) {
    pass++;
    console.log("  ✓ " + name);
  } else {
    fail++;
    console.log("  ✗ " + name + (extra ? " — " + extra : ""));
  }
};

const CHROME = process.env.CHROME_PATH ||
  (fs.existsSync("/home/rezephyr/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome")
    ? "/home/rezephyr/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome"
    : undefined);

const T0 = new Date("2026-03-01T10:00:00Z");

const run = async () => {
  const browser = await chromium.launch({
    args: ["--allow-file-access-from-files"],
    ...(CHROME ? { executablePath: CHROME } : {}),
  });
  const page = await browser.newPage({ viewport: { width: 1000, height: 680 } });

  // Fake the Tauri bridge before the app script runs. install_tool / install_extension
  // never answer on their own: the test resolves them via window.__finish.
  await page.addInitScript(() => {
    window.__listeners = {};
    window.__deferred = {};
    window.__TAURI__ = {
      core: {
        invoke: (cmd, args) => {
          if (cmd === "detect") {
            return Promise.resolve({
              os: "Test", steps: [
                { id: "vscode", label: "Visual Studio Code", status: "skipped", detail: "already installed", command: null },
                { id: "git", label: "Git", status: "pending", detail: "needs installing", command: "winget install Git.Git" },
                { id: "node", label: "Node.js LTS", status: "skipped", detail: "already installed", command: null },
                { id: "kilo", label: "Kilo Code", status: "pending", detail: "will install", command: "code --install-extension kilocode.Kilo-Code" },
                { id: "api", label: "API key", status: "pending", detail: "https://litellm.rapidscreen.io/v1", command: null },
              ],
            });
          }
          if (cmd === "install_tool") return new Promise((res) => { window.__deferred[args.id] = res; });
          if (cmd === "install_extension") return new Promise((res) => { window.__deferred.kilo = res; });
          return Promise.resolve({ ok: true, status: "done", detail: "done", log: [], fatal: null });
        },
      },
      event: {
        listen: (name, cb) => {
          (window.__listeners[name] = window.__listeners[name] || []).push(cb);
          return Promise.resolve(() => {});
        },
      },
      opener: { openUrl: async () => {} },
    };
    // Deliver an event exactly the way Tauri does: wrapped, with the payload inside.
    window.__emit = (payload) =>
      (window.__listeners["install-progress"] || []).forEach((cb) =>
        cb({ event: "install-progress", id: 1, payload }));
  });

  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

  const tick = (ms) => page.clock.runFor(ms);
  const emit = (id, line, transient) => page.evaluate((p) => window.__emit(p), { id, line, transient });
  const finish = (id, res) => page.evaluate(([i, r]) => window.__deferred[i](r), [id, res]);
  const waitFor = async (fn, arg, label) => {
    for (let i = 0; i < 100; i++) {
      if (await page.evaluate(fn, arg)) return;
      await sleep(50);
    }
    throw new Error("timed out waiting for " + label);
  };
  const row = (id) => page.evaluate((i) => {
    const r = document.querySelector('#taskRows .task[data-id="' + i + '"]');
    if (!r) return null;
    const hint = r.querySelector(".hint");
    return {
      running: r.classList.contains("running"),
      meta: r.querySelector(".meta").textContent,
      line: r.querySelector(".line") ? r.querySelector(".line").textContent : null,
      hintShown: !!hint && !hint.classList.contains("hidden"),
      hasLive: !!r.querySelector(".live"),
    };
  }, id);
  const bar = () => page.evaluate(() => ({
    width: document.getElementById("progBar").style.width,
    working: document.querySelector(".progress").classList.contains("working"),
  }));
  const logRows = () => page.evaluate(() =>
    Array.from(document.querySelectorAll("#logBox > div")).map((d) => d.textContent));

  await page.clock.install({ time: T0 });
  await page.goto(PAGE, { waitUntil: "load" });
  await waitFor(() => document.querySelectorAll("#taskRows .task").length === 4, null, "detection");
  await page.clock.pauseAt(new Date(T0.getTime() + 60_000));

  console.log("\n=== 1. the UI listens for the backend's progress events ===");
  const listening = await page.evaluate(() => Object.keys(window.__listeners));
  check("subscribed to install-progress", listening.includes("install-progress"), JSON.stringify(listening));

  console.log("\n=== 2. overall bar while a step runs ===");
  let b = await bar();
  check("idle bar counts only finished steps (2 of 4)", b.width === "50%" && !b.working, JSON.stringify(b));

  await page.click("#btnInstall");
  await waitFor(() => !!window.__deferred.git, null, "install_tool(git) call");
  b = await bar();
  check("a running step counts as half (2.5 of 4)", b.width === "63%", b.width);
  check("bar shimmers while a step runs", b.working);

  const animation = (reduced) => page.emulateMedia({ reducedMotion: reduced })
    .then(() => page.evaluate(() =>
      getComputedStyle(document.querySelector("#progBar"), "::after").animationName));
  check("shimmer animates by default", (await animation("no-preference")) === "shimmer");
  check("shimmer stops under prefers-reduced-motion", (await animation("reduce")) === "none");
  await page.emulateMedia({ reducedMotion: "no-preference" });

  console.log("\n=== 3. live line, elapsed timer and calm hint ===");
  let r = await row("git");
  check("the running step shows its elapsed time", r.running && /installing… 0:00$/.test(r.meta), r.meta);
  check("the live area exists but is empty before any output", r.hasLive && r.line === "", JSON.stringify(r));
  check("no hint at the start", !r.hintShown);

  await page.evaluate(() => { document.querySelector('#taskRows .task[data-id="git"] .spin').dataset.same = "1"; });

  await emit("git", "Downloading… 10%", true);
  r = await row("git");
  check("a line is not rendered before the throttle window ends", r.line === "", r.line);
  await tick(100);
  r = await row("git");
  check("the latest line appears under the step", r.line === "Downloading… 10%", r.line);

  await tick(5_000);
  r = await row("git");
  check("elapsed time advances with the clock", /installing… 0:05$/.test(r.meta), r.meta);
  check("ticking does not rebuild the row (spinner keeps spinning)",
    await page.evaluate(() => !!document.querySelector('#taskRows .task[data-id="git"] .spin[data-same="1"]')));

  await tick(14_000); // 19.1s
  check("no hint before 20s", !(await row("git")).hintShown);
  await tick(2_000); // 21.1s
  r = await row("git");
  check("the calm hint appears after ~20s", r.hintShown && /0:21$/.test(r.meta), JSON.stringify(r));
  const hintText = await page.evaluate(() =>
    document.querySelector('#taskRows .task[data-id="git"] .hint').textContent);
  check("the hint reassures rather than alarms", /still working/.test(hintText), hintText);

  console.log("\n=== 4. a flood of redraws is throttled and kept out of the log ===");
  const logBefore = (await logRows()).length;
  for (let i = 1; i <= 500; i++) await emit("git", "Downloading… " + (i % 100) + "%", true);
  await emit("git", "Downloading… 100%", true);
  r = await row("git");
  check("500 redraws in one burst render nothing until the window ends", r.line === "Downloading… 10%", r.line);
  await tick(100);
  r = await row("git");
  check("then only the newest redraw shows", r.line === "Downloading… 100%", r.line);
  check("redraws never reach the log", (await logRows()).length === logBefore, "rows " + logBefore + " -> " + (await logRows()).length);

  console.log("\n=== 5. real output lines go to the log too ===");
  await emit("git", "Starting package install…", false);
  await emit("git", "Successfully installed", false);
  await tick(100);
  const rows = await logRows();
  check("non-transient lines are appended to the log in order",
    rows.slice(-2).join("|").includes("Starting package install…") && rows[rows.length - 1].includes("Successfully installed"),
    JSON.stringify(rows.slice(-3)));
  r = await row("git");
  check("the latest non-transient line is also shown under the step", r.line === "Successfully installed", r.line);

  console.log("\n=== 6. other steps' output does not leak ===");
  await emit("kilo", "unrelated line", true);
  await tick(100);
  r = await row("git");
  check("a line for another step leaves this one alone", r.line === "Successfully installed", r.line);

  console.log("\n=== 7. finishing a step ===");
  await finish("git", { ok: true, status: "done", detail: "installed — git version 2.50", command: "winget install Git.Git" });
  await waitFor(() => !!window.__deferred.kilo, null, "install_extension call");
  r = await row("git");
  check("the finished step drops its live area and timer text", !r.running && !r.hasLive && r.meta === "installed — git version 2.50", JSON.stringify(r));
  check("the result is logged after the step's output",
    (await logRows()).findIndex((l) => l.includes("Successfully installed")) <
      (await logRows()).findIndex((l) => l.includes("✓ Git")));

  await emit("git", "late straggler line", false);
  await tick(100);
  r = await row("git");
  check("a straggler for a finished step is logged but not shown as live", !r.hasLive && (await logRows()).some((l) => l.includes("late straggler line")));

  console.log("\n=== 8. the Kilo extension streams too ===");
  b = await bar();
  check("bar moves on to 3.5 of 4 while the extension installs", b.width === "88%" && b.working, JSON.stringify(b));
  await emit("kilo", "Installing extensions…", false);
  await emit("kilo", "Extension 'kilocode.Kilo-Code' v5 was successfully installed.", false);
  await tick(100);
  r = await row("kilo");
  check("the extension step shows its own latest line", r.running && /successfully installed/.test(r.line), JSON.stringify(r));

  console.log("\n=== 9. everything done ===");
  await finish("kilo", { ok: true, status: "done", detail: "Kilo Code installed" });
  await waitFor(() => document.getElementById("progBar").style.width === "100%", null, "completion");
  b = await bar();
  check("bar is full and calm when nothing is running", b.width === "100%" && !b.working, JSON.stringify(b));
  const before = await row("kilo");
  await tick(30_000);
  const after = await row("kilo");
  check("no timer keeps ticking after the work is done", before.meta === after.meta && !after.hasLive, JSON.stringify([before, after]));

  console.log("\n=== 10. no stray errors ===");
  check("no JavaScript errors", errors.length === 0, errors.join(" | "));

  await browser.close();

  console.log("\n" + "=".repeat(54));
  console.log(`RESULT: ${pass} passed, ${fail} failed`);
  console.log("=".repeat(54));
  process.exit(fail ? 1 : 0);
};

run().catch((e) => {
  console.error("\nFATAL: " + e.message);
  process.exit(1);
});
