import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "@playwright/test";

const origin = "https://kite.dev.hexly.ai";
const output = new URL("../.local/evidence/", import.meta.url).pathname;
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1512, height: 1000 } });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(origin);
  await page.locator(".session-card").first().waitFor();
  assert.ok((await page.locator(".session-card").count()) >= 2);
  await page.screenshot({ path: `${output}overview-dark.png` });
  await page.getByRole("textbox", { name: "Search sessions" }).fill("no-such-directory");
  await page.getByText("No matching sessions").waitFor();
  await page.getByRole("button", { name: "Clear search" }).click();
  await page
    .getByRole("button", { name: /^Inspect kite / })
    .first()
    .click();
  await page.locator(".event-row").first().waitFor();
  assert.equal(await page.locator(".module-node").count(), 8);
  assert.ok((await page.locator(".directory-path").innerText()).endsWith("/kite"));
  await page.screenshot({ path: `${output}recording-dark.png` });
  await page.getByRole("button", { name: "From start" }).click();
  await page.waitForFunction(
    () => document.querySelector(".event-row.selected small")?.textContent === "session_start",
  );
  await page.getByRole("button", { name: "Play replay", exact: true }).click();
  await page.waitForTimeout(1600);
  await page.getByRole("button", { name: "Pause replay", exact: true }).click();
  assert.notEqual(await page.locator(".event-row.selected small").textContent(), "session_start");
  await page.screenshot({ path: `${output}replay-dark.png` });
  await page.getByRole("slider", { name: "Replay step" }).focus();
  await page.keyboard.press("End");
  await page.getByRole("button", { name: "Tools module" }).click();
  assert.ok((await page.locator(".event-row").count()) > 0);
  assert.equal(await page.locator(".event-row:not(.phase-tools)").count(), 0);
  await page.getByRole("button", { name: "tools", exact: true }).click();
  await page.getByRole("textbox", { name: "Search events" }).fill('"type":"tool_execution_end"');
  assert.equal(await page.locator(".event-row").count(), 4);
  await page.locator(".event-row").first().click();
  assert.equal(await page.locator(".payload pre").count(), 1);
  await page.getByRole("textbox", { name: "Search events" }).fill("");
  await page.getByRole("combobox", { name: "Playback speed" }).click();
  await page.getByRole("option", { name: "4×", exact: true }).click();
  assert.equal(await page.getByRole("combobox", { name: "Playback speed" }).innerText(), "4×");
  await page.getByRole("combobox", { name: "Replay timing" }).click();
  await page.getByRole("option", { name: "Recorded timing", exact: true }).click();
  await page.getByRole("button", { name: "Live", exact: true }).click();
  await page.getByText("LIVE EDGE", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Change theme" }).click();
  await page.waitForTimeout(200);
  assert.equal(await page.locator("html").getAttribute("data-mode"), "light");
  await page.screenshot({ path: `${output}recording-light.png` });
  await page.getByRole("button", { name: "All sessions", exact: true }).click();
  await page.getByRole("button", { name: "Wall view", exact: true }).click();
  assert.equal(await page.locator(".kite-sidebar").isVisible(), false);
  await page.screenshot({ path: `${output}wall-light.png` });
  await page.getByRole("button", { name: "Exit wall view", exact: true }).click();
  await page.route("**/api/sessions?**", (route) =>
    route.fulfill({ status: 503, contentType: "application/json", body: "{}" }),
  );
  await page.getByText("Collector offline", { exact: true }).waitFor();
  assert.ok((await page.locator(".session-card").count()) >= 2);
  await page.unroute("**/api/sessions?**");
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await page.getByText("Collector connected", { exact: true }).waitFor();
  await page.emulateMedia({ reducedMotion: "reduce" });
  assert.equal(
    await page.locator(".page-enter").evaluate((el) => getComputedStyle(el).animationName),
    "none",
  );
  const mobile = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    deviceScaleFactor: 1,
  });
  mobile.on("pageerror", (error) => errors.push(error.message));
  await mobile.goto(origin);
  await mobile.locator(".session-card").first().waitFor();
  assert.ok(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await mobile.screenshot({ path: `${output}mobile-overview.png` });
  await mobile.getByRole("button", { name: "Toggle navigation" }).click();
  await mobile.getByRole("dialog").waitFor();
  await mobile.keyboard.press("Escape");
  await mobile
    .getByRole("button", { name: /^Inspect kite / })
    .first()
    .click();
  await mobile.locator(".module-node").first().waitFor();
  assert.ok(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert.ok(
    await mobile
      .locator(".detail-title")
      .evaluate(
        (el) => el.getBoundingClientRect().top > 50 && el.getBoundingClientRect().bottom < innerHeight,
      ),
  );
  await mobile.screenshot({ path: `${output}mobile-recording.png` });
  const empty = await browser.newPage();
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  await empty.route("**/api/sessions?**", async (route) => {
    await pending;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ sessions: [], nextBefore: null, retentionDays: 7 }),
    });
  });
  await empty.goto(origin);
  await empty.locator(".skeleton-grid").waitFor();
  release();
  await empty.getByText("Ready when Pi is.", { exact: true }).waitFor();
  await empty.close();
  assert.deepEqual(errors, []);
  process.stdout.write(
    JSON.stringify(
      {
        status: "passed",
        origin,
        screenshots: output,
        checks: [
          "real recordings",
          "directory identity",
          "step replay",
          "keyboard seek",
          "module and payload search",
          "speed and timing",
          "live follow",
          "light and dark",
          "wall view",
          "offline and retry",
          "reduced motion",
          "mobile overflow and drawer",
        ],
        pageErrors: errors,
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
