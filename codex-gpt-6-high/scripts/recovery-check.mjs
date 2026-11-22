import { chromium } from "playwright";
import assert from "node:assert/strict";
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
const url = process.env.TEST_URL || "http://127.0.0.1:5173";
try {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 850 },
  });
  const page = await context.newPage();
  await page.clock.install({ time: new Date() });
  let calls = 0,
    fail = false;
  await page.route("**/api/harbor", async (route) => {
    calls++;
    if (fail) await route.fulfill({ status: 503, body: "unavailable" });
    else await route.continue();
  });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () => document.querySelectorAll(".ship-target").length > 0,
    null,
    { timeout: 60000 },
  );
  const before = await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem("charleston-observatory-last-good-v1"))
        .snapshot,
  );
  fail = true;
  await page.clock.fastForward(600001);
  await page.waitForSelector(".feed-banner");
  const after = await page.evaluate(() => ({
    ships: document.querySelectorAll(".ship-target").length,
    banner: document.querySelector(".feed-banner").textContent,
    body: document.body.innerText,
  }));
  assert.ok(calls >= 2, "ten-minute timer must request fresh data");
  assert.equal(after.ships, before.ais.data.vessels.length);
  assert.ok(after.body.includes("STALE"));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".ship-target", { timeout: 60000 });
  assert.equal(
    await page.locator(".ship-target").count(),
    before.ais.data.vessels.length,
  );
  const fresh = await browser.newContext({
    viewport: { width: 1280, height: 850 },
  });
  const cold = await fresh.newPage();
  await cold.route("**/api/harbor", (route) =>
    route.fulfill({ status: 503, body: "unavailable" }),
  );
  await cold.goto(url, { waitUntil: "domcontentloaded" });
  await cold.waitForSelector(".feed-banner");
  assert.equal(await cold.locator(".ship-target").count(), 0);
  console.log(
    JSON.stringify({
      url,
      automaticRefreshCalls: calls,
      retainedVessels: after.ships,
      originalFetchTime: before.ais.fetchedAt,
      staleMarked: true,
      reloadRetained: true,
      coldFailureInventedShips: 0,
    }),
  );
} finally {
  await browser.close();
}
