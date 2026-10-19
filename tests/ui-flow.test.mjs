/* End-to-end UI test for the AI Builder School setup wizard.
 *
 * Runs the real index.html in a headless browser, drives the whole flow, and asserts
 * on the resulting DOM. Requires the DOM to be exercised the same way a student would.
 *
 * Usage:  node tests/ui-flow.test.mjs
 * Requires: playwright's bundled chromium (found automatically) or CHROME_PATH set.
 */

import { chromium } from "playwright";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PAGE = "file://" + path.join(ROOT, "ui", "index.html");

/* The demo-mode key must look like a key but is never a real credential.
 * Demo mode only checks the `sk-` prefix, so this exercises the same path without
 * embedding a secret in the repo. */
const DEMO_KEY = "sk-demo-key-not-a-real-credential";

let passed = 0;
let failed = 0;
const failures = [];

function check(name, cond, extra) {
  if (cond) {
    passed++;
    console.log("  \u2713 " + name);
  } else {
    failed++;
    failures.push(name + (extra ? " \u2014 " + extra : ""));
    console.log("  \u2717 " + name + (extra ? " \u2014 " + extra : ""));
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* Wait until a predicate evaluates true in the page, or time out. */
async function waitFor(page, fn, timeout = 8000, label = "condition") {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await page.evaluate(fn)) return true;
    await sleep(120);
  }
  throw new Error("timed out waiting for " + label);
}

const run = async () => {
  fs.mkdirSync(path.join(ROOT, "tests", "screenshots"), { recursive: true });
  const shot = (page, name) =>
    page.screenshot({ path: path.join(ROOT, "tests", "screenshots", name + ".png"), fullPage: false });

  const CHROME = process.env.CHROME_PATH ||
    (fs.existsSync("/home/rezephyr/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome")
      ? "/home/rezephyr/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome"
      : undefined);
  const browser = await chromium.launch({
    args: ["--allow-file-access-from-files"],
    ...(CHROME ? { executablePath: CHROME } : {}),
  });
  const page = await browser.newPage({ viewport: { width: 1020, height: 700 } });

  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

  console.log("\n=== 1. Initial load & detection ===");
  await page.goto(PAGE, { waitUntil: "load" });
  await waitFor(page, () => document.querySelectorAll("#stepList .step").length === 5, 8000, "rail steps");
  await sleep(700);

  check("no JavaScript errors on load", errors.length === 0, errors.join(" | "));

  const railCount = await page.locator("#stepList .step").count();
  check("rail renders 5 steps", railCount === 5, "got " + railCount);

  const railLabels = await page.locator("#stepList .step .name").allInnerTexts();
  const joined = railLabels.join(" | ");
  check("rail lists the right tools",
    joined.includes("Visual Studio Code") && joined.includes("Git") &&
    joined.includes("Node.js LTS") && joined.includes("Kilo Code") && joined.includes("API key"),
    joined);

  const railSvgs = await page.locator("#stepList .step .name svg").count();
  check("every rail step has a vector icon (no emoji)", railSvgs === 5, "got " + railSvgs);

  // No emoji anywhere in the rendered UI.
  const bodyHTML = await page.evaluate(() => document.body.innerHTML);
  const emoji = bodyHTML.match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu);
  check("no emoji in the UI", !emoji, emoji ? "found: " + emoji.join("") : "");

  const osLabel = await page.locator("#osLabel").innerText();
  check("OS is reported in the sidebar", osLabel.trim().length > 0, osLabel);

  check("logo is present in the sidebar",
    await page.locator(".rail-brand img").count() === 1);

  const ragmi = await page.locator(".rail-foot a").getAttribute("href");
  check("'setup by ar-Raqmi' links to the website", ragmi === "https://ar-raqmi.net/", ragmi);

  const taskRows = await page.locator("#taskRows .task").count();
  check("system check shows 4 task rows", taskRows === 4, "got " + taskRows);

  await shot(page, "01-detect");

  console.log("\n=== 2. Install flow ===");
  await page.locator("#btnInstall").click();
  await waitFor(page, () => !document.getElementById("viewApi").classList.contains("hidden"), 20000, "api view");
  check("advances to the API key step after installing", true);

  const logText = await page.locator("#logBox").innerText();
  check("activity log recorded the work", logText.length > 20, logText.slice(0, 60));
  check("log mentions Kilo Code", /Kilo/i.test(logText), logText.slice(0, 120));

  await shot(page, "02-api-step");

  console.log("\n=== 3. API key validation ===");
  // The button holds a short latch after finishing so a double-click can't re-fire it.
  // Wait for it to be free before the next click, exactly as a human would.
  const clickPing = async () => {
    await waitFor(page, () => {
      const b = document.getElementById("btnPing");
      return b && !b.classList.contains("busy") && !b.disabled;
    }, 8000, "ping button free");
    await page.locator("#btnPing").click();
  };

  // Empty key -> refuses locally without a network call.
  await clickPing();
  await waitFor(page, () => /enter your api key/i.test(document.getElementById("pingResult").textContent), 5000, "empty-key message");
  let ping = await page.locator("#pingResult").innerText();
  check("empty key is caught before any request", /enter your api key/i.test(ping), ping);

  // Bad key -> rejected.
  await page.fill("#apiKey", "not-a-real-key");
  await clickPing();
  await waitFor(page, () => /rejected|401/i.test(document.getElementById("pingResult").textContent), 8000, "rejection");
  ping = await page.locator("#pingResult").innerText();
  check("invalid key is rejected with a clear message", /rejected|401/i.test(ping), ping);

  // Good key -> models fetched.
  await page.fill("#apiKey", DEMO_KEY);
  await clickPing();
  await waitFor(page, () => document.querySelectorAll("#modelGrid .model").length > 0, 10000, "model list");
  const modelCount = await page.locator("#modelGrid .model").count();
  check("models are fetched after a valid key", modelCount >= 10, "got " + modelCount);

  const selected = await page.locator("#modelGrid .model.on .nm").innerText();
  check("deepseek-v4.1-flash is the default selection", selected === "deepseek-v4.1-flash", selected);

  const hasRec = await page.locator("#modelGrid .model.on .rec").count();
  check("default model is tagged in the picker", hasRec === 1);

  await shot(page, "03-models");

  console.log("\n=== 4. Choosing a different model ===");
  await page.locator("#modelGrid .model", { hasText: "gpt-5.5" }).first().click();
  await sleep(300);
  const newSel = await page.locator("#modelGrid .model.on .nm").innerText();
  check("user can pick a different model", newSel === "gpt-5.5", newSel);

  // Preference persists across a reload.
  await page.reload({ waitUntil: "load" });
  await waitFor(page, () => document.querySelectorAll("#stepList .step").length === 5, 8000, "reload");
  const stored = await page.evaluate(() => localStorage.getItem("aibs.preferredModel"));
  check("model choice is remembered", stored === "gpt-5.5", String(stored));

  console.log("\n=== 5. Apply & finish ===");
  await page.locator("#btnInstall").click();
  await waitFor(page, () => !document.getElementById("viewApi").classList.contains("hidden"), 20000, "api view again");
  await page.fill("#apiKey", DEMO_KEY);
  await clickPing();
  await waitFor(page, () => document.querySelectorAll("#modelGrid .model").length > 0, 10000, "models again");
  const defAfterReload = await page.locator("#modelGrid .model.on .nm").innerText();
  check("remembered model is re-selected on reconnect", defAfterReload === "gpt-5.5", defAfterReload);

  await page.locator("#btnApply").click();
  await waitFor(page, () => !document.getElementById("viewDone").classList.contains("hidden"), 10000, "done view");
  check("apply advances to the completion screen", true);

  const doneRows = await page.locator("#doneSummary .task").count();
  check("completion screen summarises 5 items", doneRows === 5, "got " + doneRows);

  const doneText = await page.locator("#doneSummary").innerText();
  check("summary names the chosen model", doneText.includes("gpt-5.5"), doneText);
  check("summary confirms Kilo Code", /Kilo Code/i.test(doneText), doneText);

  await shot(page, "04-done");

  console.log("\n=== 6. Skip path (Kilo free models) ===");
  await page.reload({ waitUntil: "load" });
  await waitFor(page, () => document.querySelectorAll("#stepList .step").length === 5, 8000, "reload 2");
  await page.locator("#btnInstall").click();
  await waitFor(page, () => !document.getElementById("viewApi").classList.contains("hidden"), 20000, "api view 3");
  await page.locator("#btnSkipKey").click();
  await waitFor(page, () => !document.getElementById("viewDone").classList.contains("hidden"), 10000, "done via skip");
  const skipText = await page.locator("#doneSummary").innerText();
  check("skipping the key still completes setup", skipText.length > 0);
  check("skip path mentions free models", /free models/i.test(skipText), skipText);

  await shot(page, "05-skipped");

  console.log("\n=== 7. Theme toggle ===");
  await page.locator('#themeToggle button[data-t="dark"]').click();
  await sleep(250);
  const theme = await page.evaluate(() => document.documentElement.dataset.theme);
  check("dark theme applies", theme === "dark", theme);
  const bg = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--bg").trim());
  check("dark theme swaps the background token", bg === "#0b1a4a", bg);
  await shot(page, "06-dark");
  await page.locator('#themeToggle button[data-t="light"]').click();
  await sleep(200);

  console.log("\n=== 8. Layout integrity ===");
  const clipped = await page.evaluate(() => {
    const c = document.querySelector(".card");
    return getComputedStyle(c).clipPath;
  });
  check("cards use the brand's clipped corner", /polygon/.test(clipped), clipped);

  const overflow = await page.evaluate(() => {
    return document.documentElement.scrollWidth > document.documentElement.clientWidth + 2;
  });
  check("no horizontal overflow", !overflow);

  check("no JavaScript errors during the whole run", errors.length === 0, errors.join(" | "));

  await browser.close();

  console.log("\n" + "=".repeat(56));
  console.log(`RESULT: ${passed} passed, ${failed} failed`);
  if (failed) {
    console.log("\nFailures:");
    failures.forEach((f) => console.log("  - " + f));
  }
  console.log("=".repeat(56));
  process.exit(failed ? 1 : 0);
};

run().catch((e) => {
  console.error("\nFATAL: " + e.message);
  process.exit(1);
});