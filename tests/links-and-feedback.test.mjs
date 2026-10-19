/* Verifies external-link handling and click feedback in the real UI.
 *
 * Why this exists: a Tauri webview silently swallows <a href="https://…"> clicks, and
 * WebKitGTK does not reliably paint :active, so a student sees a dead click and no
 * feedback. Both regressions are invisible to a normal render test, so they get their own.
 *
 * Runs the actual ui/index.html with a fake Tauri bridge injected, then asserts on
 * behaviour: links route through the opener instead of navigating, presses produce a
 * visible state, and a rapid double-click cannot fire the work twice.
 *
 * Usage: node tests/links-and-feedback.test.mjs
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
    console.log("  \u2713 " + name);
  } else {
    fail++;
    console.log("  \u2717 " + name + (extra ? " \u2014 " + extra : ""));
  }
};

const CHROME = process.env.CHROME_PATH ||
  (fs.existsSync("/home/rezephyr/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome")
    ? "/home/rezephyr/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome"
    : undefined);

const run = async () => {
  const browser = await chromium.launch({
    args: ["--allow-file-access-from-files"],
    ...(CHROME ? { executablePath: CHROME } : {}),
  });
  const page = await browser.newPage({ viewport: { width: 1000, height: 680 } });

  // Fake the Tauri bridge before the app script runs.
  await page.addInitScript(() => {
    window.__openedUrls = [];
    window.__invokeCount = 0;
    window.__TAURI__ = {
      core: {
        invoke: async (cmd) => {
          if (cmd === "verify_key") window.__invokeCount++;
          if (cmd === "detect") {
            return {
              os: "Test", steps: [
                { id: "vscode", label: "Visual Studio Code", status: "skipped", detail: "already installed", command: null },
                { id: "git", label: "Git", status: "skipped", detail: "already installed", command: null },
                { id: "node", label: "Node.js LTS", status: "skipped", detail: "already installed", command: null },
                { id: "kilo", label: "Kilo Code", status: "pending", detail: "will install", command: "code --install-extension kilocode.Kilo-Code" },
                { id: "api", label: "API key", status: "pending", detail: "https://litellm.rapidscreen.io/v1", command: null },
              ],
            };
          }
          return { ok: true, status: "done", detail: "done", log: [], fatal: null };
        },
      },
      opener: { openUrl: async (url) => { window.__openedUrls.push(url); } },
    };
  });

  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

  console.log("\n=== 1. external links route to the OS ===");
  await page.goto(PAGE, { waitUntil: "load" });
  await sleep(1000);

  const ragmi = page.locator(".rail-foot a");
  check("ar-Raqmi link is present", (await ragmi.count()) === 1);
  check("no target=_blank on the rail link (would open a second tab)",
    (await ragmi.getAttribute("target")) === null,
    "target=" + (await ragmi.getAttribute("target")));

  const urlBefore = page.url();
  await ragmi.click();
  await sleep(350);
  let opened = await page.evaluate(() => window.__openedUrls);
  check("ar-Raqmi click does NOT navigate the app away", page.url() === urlBefore,
    urlBefore + " -> " + page.url());
  check("ar-Raqmi click calls openUrl with the right URL",
    opened.includes("https://ar-raqmi.net/"), JSON.stringify(opened));

  console.log("\n=== 2. KrackedDevs link on the API screen ===");
  await page.click("#btnInstall");
  await sleep(2200);
  const apiVisible = !(await page.locator("#viewApi").getAttribute("class")).includes("hidden");
  check("reached the API key screen", apiVisible);

  const kd = page.locator('#viewApi a[href*="krackeddevs"]');
  check("KrackedDevs link is present", (await kd.count()) === 1);
  check("no target=_blank on the KrackedDevs link",
    (await kd.getAttribute("target")) === null,
    "target=" + (await kd.getAttribute("target")));

  const urlBefore2 = page.url();
  await kd.click();
  await sleep(350);
  opened = await page.evaluate(() => window.__openedUrls);
  check("KrackedDevs click calls openUrl",
    opened.includes("https://krackeddevs.com/dashboard/profile"), JSON.stringify(opened));
  check("KrackedDevs click does not navigate away", page.url() === urlBefore2);

  console.log("\n=== 2b. one click opens exactly ONE tab ===");
  // Regression: a stray target="_blank" plus the plugin opened the browser twice.
  const before2 = await page.evaluate(() => window.__openedUrls.length);
  await kd.click();
  await sleep(300);
  const after2 = await page.evaluate(() => window.__openedUrls.length);
  check("a single click produces exactly one openUrl call",
    after2 - before2 === 1, "delta=" + (after2 - before2));

  // And two rapid taps should not double-open either.
  const before3 = await page.evaluate(() => window.__openedUrls.length);
  await kd.click();
  await kd.click();
  await sleep(300);
  const after3 = await page.evaluate(() => window.__openedUrls.length);
  check("a rapid double-tap produces exactly one openUrl call",
    after3 - before3 === 1, "delta=" + (after3 - before3));

  console.log("\n=== 3. press feedback ===");
  const btn = page.locator("#btnPing");
  await btn.dispatchEvent("pointerdown", { clientX: 5, clientY: 5 });
  await sleep(50);
  check("pressed state appears on pointerdown",
    await btn.evaluate((b) => b.classList.contains("pressed")));
  check("a ripple is created on press",
    (await btn.evaluate((b) => b.querySelectorAll(".ripple").length)) >= 1);

  await btn.dispatchEvent("pointerup");
  await sleep(50);
  check("pressed state clears on pointerup",
    await btn.evaluate((b) => !b.classList.contains("pressed")));
  await sleep(650);
  check("ripple is removed after the animation",
    (await btn.evaluate((b) => b.querySelectorAll(".ripple").length)) === 0);

  console.log("\n=== 4. keyboard press feedback ===");
  await btn.focus();
  await page.keyboard.down("Enter");
  await sleep(50);
  check("Enter shows a pressed state",
    await btn.evaluate((b) => b.classList.contains("pressed")));
  await page.keyboard.up("Enter");
  await sleep(50);
  check("pressed state clears on key up",
    await btn.evaluate((b) => !b.classList.contains("pressed")));

  console.log("\n=== 5. a rapid double-click cannot fire twice ===");
  await page.fill("#apiKey", "sk-demo-not-real");
  await page.evaluate(() => { window.__invokeCount = 0; });
  const ping = page.locator("#btnPing");
  await ping.click();
  await ping.click();
  await ping.click();
  await sleep(700);
  const fired = await page.evaluate(() => window.__invokeCount);
  check("three rapid clicks fire verify_key exactly once", fired === 1, "fired " + fired);

  console.log("\n=== 6. no stray errors ===");
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