/* Capture README screenshots of each wizard screen.
 * Runs the real index.html (demo backend) in a headless browser and walks the flow,
 * saving a PNG per screen. Run: node tests/capture-screenshots.mjs
 */
import { chromium } from "playwright";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PAGE = "file://" + path.join(ROOT, "ui", "index.html");
const OUT = path.join(ROOT, "docs", "screenshots");
const KEY = "sk-demo-key-not-a-real-credential";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const run = async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const chrome = fs.existsSync("/home/rezephyr/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome")
    ? "/home/rezephyr/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome"
    : undefined;
  const browser = await chromium.launch({
    args: ["--allow-file-access-from-files"],
    ...(chrome ? { executablePath: chrome } : {}),
  });
  const page = await browser.newPage({ viewport: { width: 1000, height: 680 }, deviceScaleFactor: 2 });

  const shot = async (name) => {
    await page.screenshot({ path: path.join(OUT, name + ".png") });
    console.log("saved", name);
  };

  const waitFor = async (fn, label) => {
    const t0 = Date.now();
    while (Date.now() - t0 < 15000) {
      if (await page.evaluate(fn)) return;
      await sleep(120);
    }
    throw new Error("timeout: " + label);
  };

  await page.goto(PAGE, { waitUntil: "load" });
  await waitFor(() => document.querySelectorAll("#stepList .step").length === 5, "rail");
  await sleep(900);
  await shot("01-detect");

  // install -> api key screen
  await page.click("#btnInstall");
  await waitFor(() => !document.getElementById("viewApi").classList.contains("hidden"), "api view");
  await sleep(700);
  await shot("02-api-key");

  // ping -> model list
  await page.fill("#apiKey", KEY);
  await page.click("#btnPing");
  await waitFor(() => document.querySelectorAll("#modelGrid .model").length > 0, "models");
  await sleep(500);
  await shot("03-models");

  // pick a different model to show the interaction
  await page.click("#modelGrid .model:has-text('gpt-5.5')");
  await sleep(400);
  await shot("03b-model-changed");

  // apply -> done
  await page.click("#btnApply");
  await waitFor(() => !document.getElementById("viewDone").classList.contains("hidden"), "done");
  await sleep(700);
  await shot("04-done");

  // dark theme on the done screen
  await page.click('#themeToggle button[data-t="dark"]');
  await sleep(500);
  await shot("05-dark");

  // skip path
  await page.click('#themeToggle button[data-t="light"]');
  await sleep(300);
  await page.reload({ waitUntil: "load" });
  await waitFor(() => document.querySelectorAll("#stepList .step").length === 5, "rail2");
  await page.click("#btnInstall");
  await waitFor(() => !document.getElementById("viewApi").classList.contains("hidden"), "api2");
  await sleep(500);
  await page.click("#btnSkipKey");
  await waitFor(() => !document.getElementById("viewDone").classList.contains("hidden"), "done2");
  await sleep(600);
  await shot("06-skipped");

  await browser.close();
  console.log("\nAll screenshots written to docs/screenshots/");
};

run().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });