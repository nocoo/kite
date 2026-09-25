import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";

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
  assert.equal((await page.locator("aside").boundingBox()).width, 260);
  assert.equal((await page.locator("main > header").boundingBox()).height, 56);
  assert.deepEqual(
    await page.locator("#observatory-content").evaluate((el) => ({
      padding: getComputedStyle(el).padding,
      radius: getComputedStyle(el).borderRadius,
      x: el.getBoundingClientRect().x,
    })),
    { padding: "20px", radius: "20px", x: 272 },
  );
  assert.equal(
    await page.locator("#observatory-content h1").evaluate((el) => getComputedStyle(el).fontSize),
    "24px",
  );
  assert.equal(await page.getByRole("navigation", { name: "Breadcrumb" }).count(), 0);
  const logo = await page.locator(".brand-mark").boundingBox();
  assert.equal(logo.width, 24);
  assert.equal(logo.x, 24);
  assert.equal(await page.locator(".brand-mark").evaluate((el) => el.complete && el.naturalWidth > 0), true);
  assert.deepEqual(
    await page
      .locator('link[rel="icon"]')
      .evaluateAll((icons) => icons.map((icon) => icon.getAttribute("href"))),
    ["/logo-16.png", "/logo-32.png"],
  );
  for (const size of [16, 24, 32, 48]) {
    assert.equal(
      await page.evaluate(async (size) => {
        const img = new Image();
        img.src = `/logo-${size}.png`;
        await img.decode();
        return img.naturalWidth;
      }, size),
      size,
    );
  }
  assert.deepEqual(
    await page.locator("main > header a").evaluateAll((links) => links.map((link) => link.href)),
    ["https://github.com/nocoo/kite", "https://hexly.ai/projects/kite"],
  );
  assert.equal(await page.locator("main > header button").last().getAttribute("aria-label"), "Change theme");
  await page.getByRole("button", { name: "Collapse sidebar", exact: true }).click();
  await expect.poll(async () => (await page.locator("aside").boundingBox()).width).toBe(68);
  assert.deepEqual(await page.locator(".brand-mark").boundingBox(), logo);
  await page.screenshot({ path: `${output}sidebar-collapsed-dark.png` });
  await page.getByRole("button", { name: "Expand sidebar", exact: true }).click();
  await expect.poll(async () => (await page.locator("aside").boundingBox()).width).toBe(260);
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
  await page.getByRole("button", { name: "Captured payload", exact: true }).click();
  await expect(page.locator(".payload pre")).toBeHidden();
  await page.getByRole("button", { name: "Captured payload", exact: true }).press("Enter");
  await expect(page.locator(".payload pre")).toBeVisible();
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
  await page.getByRole("link", { name: "Observatory", exact: true }).click();
  await expect(page.locator("#observatory-content h1")).toHaveText("Observatory");
  assert.equal(await page.locator("#observatory-content").evaluate((el) => el.scrollTop), 0);
  await page.getByRole("button", { name: "Collapse sidebar", exact: true }).click();
  await expect.poll(async () => (await page.locator("aside").boundingBox()).width).toBe(68);
  await page.screenshot({ path: `${output}sidebar-collapsed-light.png` });
  await page.getByRole("button", { name: "Wall view", exact: true }).click();
  assert.equal(await page.locator(".kite-sidebar").isVisible(), false);
  await page.screenshot({ path: `${output}wall-light.png` });
  await page.getByRole("button", { name: "Exit wall view", exact: true }).click();
  assert.equal((await page.locator("aside").boundingBox()).width, 68);
  await page.getByRole("button", { name: "Expand sidebar", exact: true }).click();
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
  assert.equal(await mobile.locator("aside").count(), 0);
  const metricPositions = await mobile
    .locator(".overview-metrics > *")
    .evaluateAll((cards) => cards.map((card) => card.getBoundingClientRect().y));
  assert.equal(metricPositions[0], metricPositions[1]);
  await mobile.screenshot({ path: `${output}mobile-overview.png` });
  await mobile.getByRole("button", { name: "Open navigation" }).click();
  await mobile.getByRole("dialog").waitFor();
  assert.equal((await mobile.getByRole("dialog").boundingBox()).width, 260);
  assert.equal(await mobile.locator("aside").count(), 1);
  assert.equal(await mobile.locator("body").getAttribute("data-scroll-locked"), "1");
  await mobile.keyboard.press("Shift+Tab");
  assert.ok(await mobile.getByRole("dialog").evaluate((el) => el.contains(document.activeElement)));
  await mobile.screenshot({ path: `${output}mobile-navigation.png` });
  await mobile.keyboard.press("Escape");
  await expect(mobile.getByRole("dialog")).toHaveCount(0);
  await expect(mobile.getByRole("button", { name: "Open navigation" })).toBeFocused();
  assert.equal(await mobile.locator("body").getAttribute("data-scroll-locked"), null);
  await mobile.getByRole("button", { name: "Open navigation" }).click();
  await mobile
    .getByRole("dialog")
    .getByRole("button", { name: /^kite / })
    .first()
    .click();
  await expect(mobile.getByRole("dialog")).toHaveCount(0);
  await expect(mobile.locator("#observatory-content h1")).toHaveText("kite");
  await mobile.getByRole("link", { name: "Observatory", exact: true }).click();
  await mobile
    .getByRole("button", { name: /^Inspect kite / })
    .first()
    .click();
  await mobile.locator(".module-node").first().waitFor();
  assert.ok(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert.ok(
    await mobile
      .locator("#observatory-content h1")
      .evaluate(
        (el) => el.getBoundingClientRect().top > 50 && el.getBoundingClientRect().bottom < innerHeight,
      ),
  );
  assert.ok(
    await mobile.locator(".replay-actions button").evaluateAll((buttons) =>
      buttons.every((button) => {
        const bounds = button.getBoundingClientRect();
        return bounds.left >= 0 && bounds.right <= innerWidth;
      }),
    ),
  );
  await mobile.getByRole("combobox", { name: "Replay timing" }).click();
  await mobile.getByRole("option", { name: "Recorded timing", exact: true }).click();
  await mobile.getByRole("button", { name: "From start", exact: true }).click();
  await mobile.waitForFunction(
    () => document.querySelector(".event-row.selected small")?.textContent === "session_start",
  );
  await mobile.screenshot({ path: `${output}mobile-recording.png` });
  for (const width of [320, 768, 1024]) {
    await mobile.setViewportSize({ width, height: 844 });
    await expect
      .poll(() => mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
  }
  await mobile.setViewportSize({ width: 390, height: 844 });
  await mobile.getByRole("button", { name: "Open navigation" }).click();
  await mobile.getByRole("dialog").waitFor();
  await mobile.setViewportSize({ width: 1024, height: 844 });
  await expect(mobile.getByRole("dialog")).toHaveCount(0);
  assert.equal(await mobile.locator("aside").count(), 1);
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
          "standard shell geometry and logo anchors",
          "breadcrumb navigation and header links",
          "keyboard payload disclosure",
          "drawer focus, scroll lock and responsive transition",
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
