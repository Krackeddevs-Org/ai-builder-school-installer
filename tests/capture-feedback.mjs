/* Captures the pressed / busy button states for visual review.
 * Usage: node tests/capture-feedback.mjs
 */
import { chromium } from "playwright";
import path from "path";
import fs from "fs";

const ROOT = path.resolve(import.meta.dirname, "..");
const PAGE = "file://" + path.join(ROOT, "ui", "index.html");
const OUT = path.join(ROOT, "docs", "screenshots");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CHROME = "/home/rezephyr/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome";

const waitFor = async (page, fn, timeout, label) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await page.evaluate(fn)) return true;
    await sleep(80);
  }
  throw new Error("timeout waiting for " + label);
};

const browser = await chromium.launch({
  args: ["--allow-file-access-from-files"],
  ...(fs.existsSync(CHROME) ? { executablePath: CHROME } : {}),
});
const page = await browser.newPage({ viewport: { width: 1000, height: 680 }, deviceScaleFactor: 2 });

await page.addInitScript(() => {
  window.__TAURI__ = {
    core: { invoke: async (cmd) => {
      if (cmd === "detect") return { os: "Linux (Arch)", steps: [
        { id: "vscode", label: "Visual Studio Code", status: "skipped", detail: "already installed — 1.131.0", command: null },
        { id: "git", label: "Git", status: "skipped", detail: "already installed — git version 2.56.0", command: null },
        { id: "node", label: "Node.js LTS", status: "skipped", detail: "already installed — v26.7.0", command: null },
        { id: "kilo", label: "Kilo Code", status: "pending", detail: "will install", command: "code --install-extension kilocode.Kilo-Code" },
        { id: "api", label: "API key", status: "pending", detail: "https://litellm.rapidscreen.io/v1", command: null },
      ]};
      // Match the real VerifyOutcome shape so screenshots are honest.
      if (cmd === "verify_key") return {
        ok: true,
        models: ["deepseek-v4.1-flash","gpt-5.4","gpt-5.4-mini","gpt-5.4-nano","gpt-5.5",
                 "gpt-5.6-luna","gpt-5.6-sol","gpt-5.6-terra","gpt-6-astra","gpt-6-luna",
                 "gpt-6-sol","gpt-image-2"],
        default_model: "deepseek-v4.1-flash",
        message: "Connected — 12 models available.",
        latency_ms: 412,
      };
      return { ok: true, status: "done", detail: "done", log: [], fatal: null };
    }},
    opener: { openUrl: async () => {} },
  };
});

await page.goto(PAGE, { waitUntil: "load" });
await sleep(1000);

// 1. pressed state mid-press on the primary button
const install = page.locator("#btnInstall");
await install.dispatchEvent("pointerdown", { clientX: 700, clientY: 20 });
await sleep(120);
await page.screenshot({ path: path.join(OUT, "07-press-feedback.png") });
console.log("saved 07-press-feedback.png");
await install.dispatchEvent("pointerup");

// 2. busy state: reach the API screen, slow the handler, and click for real so the
//    button is genuinely mid-work when the shot is taken.
await sleep(600);
await install.click();
await sleep(2500);
await page.fill("#apiKey", "sk-demo-not-real");
await page.evaluate(() => {
  // Slow verify_key so the busy state lasts long enough to capture.
  const orig = window.__TAURI__.core.invoke;
  window.__TAURI__.core.invoke = async (cmd, a) => {
    if (cmd === "verify_key") await new Promise((r) => setTimeout(r, 3000));
    return orig(cmd, a);
  };
});
const ping = page.locator("#btnPing");
// Hold the button busy deterministically: dispatch a real click, then remove the
// artificial delay AFTER the busy class has been applied so the shot is stable.
await ping.click({ noWaitAfter: true }).catch(() => {});
await waitFor(page, () => document.getElementById("btnPing").classList.contains("busy"), 3000, "busy state");
await page.screenshot({ path: path.join(OUT, "08-busy-feedback.png") });
console.log("saved 08-busy-feedback.png");

await browser.close();
console.log("\nScreenshots in docs/screenshots/");