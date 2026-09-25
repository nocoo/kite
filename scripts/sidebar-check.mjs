import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";

const output = new URL("../.local/evidence/", import.meta.url).pathname;
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const errors = [];
const now = Date.now();
let offline = false;
let revision = 0;
let served = -1;
let sessions = Array.from({ length: 20 }, (_, index) => ({
  source: "pi",
  sessionId: `fixture-session-${index}`,
  producerId: `run-${index.toString().padStart(2, "0")}`,
  firstCursor: index + 1,
  lastCursor: 100 - index,
  firstSeen: now - 60_000,
  lastSeen: now,
  eventCount: 30,
  cwd: `/workspace/${index === 19 ? "older-recording" : `project-${index}`}`,
  provider: "browser-fixture",
  model: "local",
  lastEvent: index === 2 || index === 7 ? "tool_execution_update" : "session_shutdown",
  lastLifecycle: index === 2 || index === 7 ? "agent_start" : "session_shutdown",
  lastActivity: "tool_execution_update",
  toolCount: 4,
  errorCount: 0,
  lossCount: 0,
}));
try {
  const page = await browser.newPage({ viewport: { width: 1512, height: 982 } });
  page.setDefaultTimeout(15000);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/sessions?**", async (route) => {
    await route.fulfill({
      status: offline ? 503 : 200,
      contentType: "application/json",
      body: JSON.stringify({
        sessions: sessions.map((session) => ({ ...session, lastSeen: Date.now() })),
        nextBefore: null,
        retentionDays: 7,
      }),
    });
    served = revision;
  });
  await page.route("**/api/events?**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: '{"events":[]}' }),
  );
  await page.goto("https://kite.dev.hexly.ai");
  await expect(page.locator(".session-item")).toHaveCount(20);
  await expect(page.getByRole("textbox", { name: "Search sessions" })).toHaveCount(1);
  await expect(page.locator(".fleet-rail")).toHaveCount(0);
  const live = page.getByRole("region", { name: "Live sessions", exact: true });
  await expect(live.locator(".session-item")).toHaveCount(2);
  const keys = async (scope = page.locator(".session-navigation")) =>
    scope.locator(".session-item").evaluateAll((items) => items.map((item) => item.dataset.sessionKey));
  const original = await keys();
  assert.ok(original[0].includes("run-02"));
  assert.ok(original[1].includes("run-07"));
  const positions = async () =>
    page
      .locator(".module-node")
      .evaluateAll((items) => items.map((item) => item.getBoundingClientRect().toJSON()));
  const geometry = await positions();
  await page.waitForTimeout(1300);
  assert.deepEqual(await keys(), original);
  assert.deepEqual(await positions(), geometry);
  assert.equal(
    await live
      .locator(".session-beacon")
      .first()
      .evaluate((el) => getComputedStyle(el, "::after").animationName),
    "session-halo",
  );
  await page.screenshot({ path: `${output}sidebar-live-dark.png`, animations: "disabled" });
  await page.getByRole("button", { name: "Change theme" }).click();
  await page.screenshot({ path: `${output}sidebar-live-light.png`, animations: "disabled" });

  const promoting = page.getByRole("button", { name: /^Inspect project-0 / });
  await promoting.focus();
  sessions = sessions.map((session, index) =>
    index === 0
      ? { ...session, lastLifecycle: "agent_start" }
      : index === 2
        ? { ...session, lastLifecycle: "agent_settled" }
        : session,
  );
  revision++;
  await expect.poll(() => served).toBe(revision);
  await expect(live.locator(".session-item").first()).toHaveAccessibleName(/Inspect project-0 /);
  await expect(promoting).toBeFocused();
  const promoted = await keys(live);
  assert.ok(promoted[1].includes("run-07"));
  await expect(
    page.getByRole("region", { name: "Other recordings" }).locator(".session-item").first(),
  ).toHaveAccessibleName(/Inspect project-1 /);
  assert.deepEqual(await positions(), geometry);
  const demoting = page.getByRole("button", { name: /^Inspect project-7 / });
  await demoting.focus();
  sessions = sessions.map((session, index) =>
    index === 7
      ? { ...session, lastLifecycle: "agent_settled" }
      : index === 2
        ? { ...session, lastLifecycle: "agent_start" }
        : session,
  );
  revision++;
  await expect.poll(() => served).toBe(revision);
  await expect(demoting).toHaveAccessibleName(/Settled/);
  await expect(demoting).toBeFocused();
  await page.getByRole("button", { name: "Filter live sessions" }).focus();
  revision++;
  await expect.poll(() => served).toBe(revision);
  await expect(page.getByRole("button", { name: "Filter live sessions" })).toBeFocused();
  await page.getByRole("button", { name: "Filter live sessions" }).click();
  await expect(page.locator(".session-item")).toHaveCount(2);
  await page.getByRole("button", { name: "Clear session filters" }).click();
  await expect(page.locator(".session-item")).toHaveCount(20);
  await page.getByRole("textbox", { name: "Search sessions" }).fill("older-recording");
  await expect(page.locator(".session-item")).toHaveCount(1);
  await page.locator(".session-item").click();
  await expect(page.locator(".session-item")).toHaveAttribute("aria-current", "page");
  await expect(page.locator(".stage-identity")).toContainText("older-recording");
  await page.getByRole("button", { name: "Clear session filters" }).click();
  await page.setViewportSize({ width: 1512, height: 768 });
  const older = page.getByRole("button", { name: /^Inspect older-recording / });
  await older.focus();
  const focusedRowVisible = () =>
    older.evaluate((element) => {
      const row = element.getBoundingClientRect();
      const navigation = element.closest("nav").getBoundingClientRect();
      return row.top >= navigation.top - 1 && row.bottom <= navigation.bottom + 1;
    });
  for (const lifecycle of ["agent_start", "session_shutdown"]) {
    sessions = sessions.map((session, index) =>
      index === 19 ? { ...session, lastLifecycle: lifecycle } : session,
    );
    revision++;
    await expect.poll(() => served).toBe(revision);
    await expect(older).toHaveAccessibleName(lifecycle === "agent_start" ? /Running/ : /Closed/);
    await expect(older).toBeFocused();
    await expect.poll(focusedRowVisible).toBe(true);
  }
  await page.setViewportSize({ width: 1512, height: 982 });
  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await expect.poll(async () => (await page.locator(".kite-sidebar").boundingBox()).width).toBe(68);
  await expect(page.locator(".session-icon")).toHaveCount(20);
  await page.locator(".session-icon").first().hover();
  await expect(page.getByRole("tooltip")).toContainText("/workspace/project-0");
  await page.getByRole("button", { name: "Find sessions" }).click();
  await expect(page.getByRole("textbox", { name: "Search sessions" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Search sessions" })).toBeFocused();
  await expect.poll(async () => (await page.locator(".kite-sidebar").boundingBox()).width).toBe(260);

  offline = true;
  await page.getByText("Collector offline", { exact: true }).waitFor();
  await expect(page.locator(".session-beacon.is-live")).toHaveCount(0);
  await expect(page.locator(".group-live")).toContainText("Last observed live");
  await expect(live.locator(".session-item").first()).toHaveAccessibleName(/Offline · last observed Running/);
  offline = false;
  await page.getByText("Collector connected", { exact: true }).waitFor();
  await expect(page.locator(".session-beacon.is-live")).toHaveCount(2);
  await page.emulateMedia({ reducedMotion: "reduce" });
  assert.equal(
    await live
      .locator(".session-beacon.is-live")
      .first()
      .evaluate((el) => getComputedStyle(el, "::after").animationName),
    "none",
  );
  await page.getByRole("button", { name: "Wall view", exact: true }).click();
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(page.getByRole("dialog").locator(".session-item")).toHaveCount(20);
  await page.getByRole("dialog").locator(".session-item").first().click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator("#main-content")).toBeFocused();
  assert.deepEqual(errors, []);
  const result = {
    status: "passed",
    source: "browser-only session fixtures; collector data unchanged",
    checks: [
      "single navigation",
      "all 20 recordings reachable",
      "live priority and stable refresh order",
      "status promotion and demotion",
      "keyboard focus across priority changes",
      "focused recordings remain visible after moving between groups",
      "live filter and identity search",
      "collapsed shortcuts and tooltips",
      "offline halo removal",
      "reduced motion",
      "wall navigation and focus",
    ],
    pageErrors: errors,
  };
  await writeFile(`${output}sidebar-navigation.json`, JSON.stringify(result, null, 2));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} finally {
  await browser.close();
}
