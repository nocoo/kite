import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";

const origin = "https://kite.dev.hexly.ai";
const output = new URL("../.local/evidence/", import.meta.url).pathname;
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const errors = [];
const geometry = [];
async function bounded(page, label) {
  const measurement = await page.evaluate(() => {
    const island = document.querySelector("#observatory-content");
    const map = document.querySelector(".execution-map").getBoundingClientRect();
    const nodes = [...document.querySelectorAll(".module-node,.tool-node")].map((el) => {
      const rect = el.getBoundingClientRect();
      return {
        name: el.getAttribute("aria-label"),
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      };
    });
    return {
      width: innerWidth,
      height: innerHeight,
      documentWidth: document.documentElement.scrollWidth,
      islandWidth: island.clientWidth,
      islandScrollWidth: island.scrollWidth,
      islandHeight: island.clientHeight,
      islandScroll: island.scrollHeight,
      map: { x: map.x, y: map.y, width: map.width, height: map.height },
      nodes,
    };
  });
  assert.ok(measurement.documentWidth <= measurement.width, `${label}: document width`);
  assert.ok(measurement.islandScrollWidth <= measurement.islandWidth + 1, `${label}: island width`);
  if (measurement.width >= 1280) {
    assert.ok(measurement.islandScroll <= measurement.islandHeight + 1, `${label}: island must not scroll`);
    for (const node of measurement.nodes) {
      assert.ok(
        node.y >= measurement.map.y && node.y + node.height <= measurement.map.y + measurement.map.height + 1,
        `${label}: ${node.name} stays inside the map`,
      );
    }
  }
  geometry.push({ label, ...measurement });
  return measurement;
}
try {
  const page = await browser.newPage({ viewport: { width: 1512, height: 982 } });
  page.setDefaultTimeout(15000);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(origin);
  await page.locator(".fleet-session").first().waitFor();
  await expect(page.locator("#observatory-content h1")).toHaveText("Execution bridge");
  assert.equal((await page.locator("aside.kite-sidebar").boundingBox()).width, 260);
  assert.equal((await page.locator("main > header").boundingBox()).height, 56);
  const logo = await page.locator(".brand-mark").boundingBox();
  assert.equal(logo.width, 24);
  assert.equal(logo.x, 24);
  await bounded(page, "global 1512");
  await page.screenshot({ path: `${output}bridge-global-dark.png` });
  const before = await page
    .locator(".fleet-session")
    .evaluateAll((els) =>
      els.map((el) => ({ id: el.getAttribute("aria-label"), y: el.getBoundingClientRect().y })),
    );
  await page.waitForTimeout(2200);
  assert.deepEqual(
    await page
      .locator(".fleet-session")
      .evaluateAll((els) =>
        els.map((el) => ({ id: el.getAttribute("aria-label"), y: el.getBoundingClientRect().y })),
      ),
    before,
  );
  await page.getByRole("button", { name: "Show running sessions" }).click();
  await expect(page.getByRole("button", { name: "Show running sessions" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByRole("button", { name: "Clear session filters" }).click();
  await page.getByRole("textbox", { name: "Search sessions" }).fill("no-such-recording");
  await expect(page.getByText("No matching sessions", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Clear session filters" }).click();
  await page.getByRole("button", { name: "Tools module" }).click();
  assert.equal(await page.getByRole("button", { name: "Tools module" }).getAttribute("aria-pressed"), "true");
  await page.getByRole("button", { name: "Clear session filters" }).click();
  await page.getByRole("textbox", { name: "Search sessions" }).fill("kite");
  await page
    .getByRole("button", { name: /^Inspect kite / })
    .first()
    .click();
  await page.locator(".tool-node").first().waitFor();
  await expect(page.locator("#main-content")).toBeFocused();
  assert.equal(await page.locator(".module-node").count(), 8);
  assert.equal(await page.locator(".tool-node").count(), 3);
  await bounded(page, "detail 1512");
  await page.screenshot({ path: `${output}bridge-recording-dark.png` });
  if (await page.getByRole("button", { name: "Previous tool group" }).isEnabled())
    await page.getByRole("button", { name: "Previous tool group" }).click();
  await expect(page.locator(".tool-node").first()).toContainText("probe");
  if (await page.getByRole("button", { name: "Next tool group" }).isEnabled())
    await page.getByRole("button", { name: "Next tool group" }).click();
  await page.getByRole("button", { name: "Follow", exact: true }).click();
  const tool = page.locator(".tool-node").first();
  await tool.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("tab", { name: "Observation", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.locator(".payload pre")).toBeVisible();
  await page.getByRole("button", { name: "Recording identity", exact: true }).click();
  await expect(page.locator(".recording-facts")).toContainText("kite-probe");
  await page.getByRole("button", { name: "Recording identity", exact: true }).click();
  await page.getByRole("button", { name: "Captured payload", exact: true }).click();
  await expect(page.locator(".payload pre")).toBeHidden();
  await page.getByRole("button", { name: "Captured payload", exact: true }).press("Enter");
  await expect(page.locator(".payload pre")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(tool).toBeFocused();
  await page.getByRole("button", { name: "Tools module" }).click();
  assert.ok((await page.locator(".event-list .event-row").count()) > 0);
  assert.equal(await page.locator(".event-list .event-row:not(.phase-tools)").count(), 0);
  await page.getByRole("textbox", { name: "Search events" }).fill("tool_execution_end");
  assert.ok((await page.locator(".event-list .event-row").count()) > 0);
  await page.getByRole("textbox", { name: "Search events" }).fill("");
  await page.getByRole("tab", { name: "Tools", exact: true }).click();
  await expect(page.locator(".evidence-tool").first()).toBeVisible();
  await page.getByRole("tab", { name: "Response", exact: true }).click();
  await expect(page.getByRole("button", { name: "Provider-exposed thinking" })).toBeVisible();
  await page.screenshot({ path: `${output}bridge-evidence.png` });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "From start", exact: true }).click();
  await expect(page.locator(".ribbon-events .event-row.selected small")).toHaveText("session_start");
  const mapBefore = await page
    .locator(".module-node")
    .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().toJSON()));
  await page.getByRole("button", { name: "Play replay", exact: true }).click();
  await page.waitForTimeout(1800);
  await expect(page.locator(".execution-map")).toHaveClass(/is-animating/);
  await expect(page.getByRole("img", { name: "Replay playing", exact: true })).toHaveClass(
    "status-dot replaying",
  );
  await expect(page.locator(".stage-heading")).toContainText("Replay ·");
  assert.ok((await page.locator(".energized .signal").count()) > 0);
  assert.equal(
    await page
      .locator(".energized .signal")
      .first()
      .evaluate((el) => getComputedStyle(el).animationName),
    "signal-flow",
  );
  assert.deepEqual(
    await page
      .locator(".module-node")
      .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().toJSON())),
    mapBefore,
  );
  await page.screenshot({ path: `${output}bridge-replay-dark.png` });
  await page.getByRole("button", { name: "Pause replay", exact: true }).click();
  await page.getByRole("slider", { name: "Replay step" }).focus();
  await page.keyboard.press("End");
  await page.getByRole("combobox", { name: "Playback speed" }).click();
  await page.getByRole("option", { name: "4×", exact: true }).click();
  await page.getByRole("combobox", { name: "Replay timing" }).click();
  await page.getByRole("option", { name: "Recorded timing", exact: true }).click();
  await page.getByRole("button", { name: "Live", exact: true }).click();
  await expect(page.getByText("LIVE EDGE", { exact: true })).toBeVisible();
  await expect(page.locator(".stage-identity .status-dot")).not.toHaveClass(/running|replaying/);
  for (const size of [
    { width: 1366, height: 768 },
    { width: 1920, height: 1080 },
    { width: 2560, height: 1440 },
  ]) {
    await page.setViewportSize(size);
    await page.waitForTimeout(350);
    await bounded(page, `detail ${size.width}`);
    await page.screenshot({ path: `${output}bridge-${size.width}-dark.png` });
  }
  await page.setViewportSize({ width: 1512, height: 982 });
  await page.getByRole("button", { name: "Change theme" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-mode", "light");
  await page.screenshot({ path: `${output}bridge-recording-light.png`, animations: "disabled" });
  await page.getByRole("button", { name: "Collapse sidebar", exact: true }).click();
  await expect.poll(async () => (await page.locator("aside.kite-sidebar").boundingBox()).width).toBe(68);
  assert.deepEqual(await page.locator(".brand-mark").boundingBox(), logo);
  await page.getByRole("button", { name: "Wall view", exact: true }).click();
  assert.equal(await page.locator(".kite-sidebar").isVisible(), false);
  await bounded(page, "wall 1512");
  await page.screenshot({ path: `${output}bridge-wall-light.png`, animations: "disabled" });
  await page.getByRole("button", { name: "Exit wall view", exact: true }).click();
  await page.getByRole("button", { name: "Expand sidebar", exact: true }).click();
  await page.route("**/api/sessions?**", (route) =>
    route.fulfill({ status: 503, contentType: "application/json", body: "{}" }),
  );
  await page.getByText("Collector offline", { exact: true }).waitFor();
  assert.equal(await page.locator(".module-node").count(), 8);
  await bounded(page, "offline 1512");
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await page.getByText("Collector offline", { exact: true }).waitFor();
  await page.unroute("**/api/sessions?**");
  await page.getByText("Collector connected", { exact: true }).waitFor();
  await page.getByRole("button", { name: "From start", exact: true }).click();
  await page.getByRole("button", { name: "Play replay", exact: true }).click();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.waitForTimeout(600);
  assert.ok(
    (
      await page
        .locator(".execution-map *")
        .evaluateAll((els) => els.map((el) => getComputedStyle(el).animationName))
    ).every((name) => name === "none"),
  );
  await page.getByRole("button", { name: "Pause replay", exact: true }).click();
  await page.getByRole("link", { name: "Observatory", exact: true }).click();
  await expect(page.getByRole("region", { name: "Fleet phase map" })).toBeVisible();
  const mobile = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    deviceScaleFactor: 1,
  });
  mobile.setDefaultTimeout(15000);
  mobile.on("pageerror", (error) => errors.push(error.message));
  await mobile.goto(origin);
  await mobile.locator(".fleet-session").first().waitFor();
  await bounded(mobile, "mobile global");
  await mobile.screenshot({ path: `${output}bridge-mobile-global.png` });
  await mobile.getByRole("button", { name: "Open navigation" }).click();
  assert.equal((await mobile.getByRole("dialog").boundingBox()).width, 260);
  assert.equal(await mobile.locator("body").getAttribute("data-scroll-locked"), "1");
  await mobile.keyboard.press("Escape");
  await expect(mobile.getByRole("button", { name: "Open navigation" })).toBeFocused();
  await mobile.getByRole("button", { name: "Open navigation" }).click();
  await mobile
    .getByRole("dialog")
    .getByRole("button", { name: /^kite / })
    .first()
    .click();
  await expect(mobile.getByRole("dialog")).toHaveCount(0);
  await mobile.locator(".tool-node").first().waitFor();
  await bounded(mobile, "mobile detail");
  await mobile.screenshot({ path: `${output}bridge-mobile-detail.png` });
  await mobile.getByRole("button", { name: "Inspect evidence" }).click();
  await expect(mobile.getByRole("dialog")).toBeVisible();
  await mobile.getByRole("tab", { name: "Response", exact: true }).click();
  await mobile.keyboard.press("Escape");
  await expect(mobile.getByRole("button", { name: "Inspect evidence" })).toBeFocused();
  for (const width of [320, 768, 1024]) {
    await mobile.setViewportSize({ width, height: 844 });
    await bounded(mobile, `responsive ${width}`);
    assert.ok(
      await mobile.locator(".replay-actions button").evaluateAll((buttons) =>
        buttons.every((button) => {
          const r = button.getBoundingClientRect();
          return r.left >= 0 && r.right <= innerWidth;
        }),
      ),
    );
  }
  const empty = await browser.newPage();
  await empty.route("**/api/sessions?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ sessions: [], nextBefore: null, retentionDays: 7 }),
    }),
  );
  await empty.goto(origin);
  await expect(empty.getByText("Ready when Pi is.", { exact: true })).toBeVisible();
  await empty.close();
  assert.deepEqual(errors, []);
  process.stdout.write(
    JSON.stringify(
      {
        status: "passed",
        origin,
        screenshots: output,
        geometry,
        pageErrors: errors,
        checks: [
          "real local recordings",
          "stable fleet ordering and map geometry",
          "desktop viewport containment",
          "individual tool stages",
          "module filters",
          "timeline and payload inspection",
          "replay and keyboard seeking",
          "light/dark and wall mode",
          "offline recovery",
          "reduced motion",
          "mobile navigation and evidence focus",
        ],
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
