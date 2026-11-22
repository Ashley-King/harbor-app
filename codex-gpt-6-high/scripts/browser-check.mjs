import { chromium } from "playwright";
import fs from "node:fs/promises";
const url = process.env.TEST_URL || "http://127.0.0.1:5173";
const browser = await chromium.launch({
  headless: true,
  executablePath:
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  args: [
    "--enable-webgl",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});
const context = await browser.newContext({
  viewport: { width: 1600, height: 1000 },
  deviceScaleFactor: 1,
});
const page = await context.newPage();
const errors = [],
  failed = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("requestfailed", (r) =>
  failed.push({
    url: r.url().replace(/\?.*$/, ""),
    reason: r.failure()?.errorText,
  }),
);
await page.goto(url, { waitUntil: "domcontentloaded" });
await page.waitForFunction(
  () => document.querySelectorAll(".ship-target").length > 0,
  null,
  { timeout: 60000 },
);
await page.waitForTimeout(6000);
const state = await page.evaluate(() => ({
  title: document.title,
  ships: document.querySelectorAll(".ship-target").length,
  rows: document.querySelectorAll(".vessel-row").length,
  body: document.body.innerText,
  overflow: document.documentElement.scrollWidth > innerWidth,
  canvas: !!document.querySelector(".maplibregl-canvas"),
}));
await fs.mkdir("artifacts", { recursive: true });
await page.screenshot({ path: "artifacts/desktop-night.png", fullPage: true });
await page.getByRole("button", { name: "Day", exact: true }).click();
await page.waitForTimeout(1500);
await page.screenshot({ path: "artifacts/desktop-day.png", fullPage: true });
await page.getByRole("button", { name: "Night", exact: true }).click();
await page
  .locator(".vessel-row")
  .filter({ hasText: "CHANNEL PEARL" })
  .first()
  .click();
await page.waitForTimeout(3500);
await page.screenshot({ path: "artifacts/vessel-detail.png", fullPage: true });
const detail = await page.locator(".vessel-detail").innerText();
await page
  .getByRole("button", { name: "HARBOR TRAFFIC", exact: false })
  .click();
await page.getByRole("tab", { name: "At terminals" }).click();
await page.screenshot({ path: "artifacts/terminals.png", fullPage: true });
await page.getByTitle("Fit the whole harbor").click();
await page.waitForTimeout(1800);
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(500);
if (
  await page
    .locator(".sidebar")
    .evaluate((el) => el.classList.contains("mobile-open"))
)
  await page.getByRole("button", { name: "Close harbor panel" }).click();
await page.getByTitle("Fit the whole harbor").click();
await page.waitForTimeout(3500);
await page.screenshot({ path: "artifacts/mobile-map.png", fullPage: true });
await page.locator(".mobile-panel-button").click();
await page.waitForTimeout(500);
await page.screenshot({ path: "artifacts/mobile-panel.png", fullPage: true });
const mobile = await page.evaluate(() => ({
  overflow: document.documentElement.scrollWidth > innerWidth,
  panel: document.querySelector(".sidebar").getBoundingClientRect().toJSON(),
}));
console.log(
  JSON.stringify({ url, state, detail, mobile, errors, failed }, null, 2),
);
await browser.close();
if (errors.length || state.overflow || mobile.overflow) process.exitCode = 1;
