import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";

const output = new URL("../.local/evidence/", import.meta.url).pathname;
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const results = [];

async function inspect(page, label) {
  await page.screenshot({ path: `${output}palette-${label}.png`, animations: "disabled" });
  const result = await page.evaluate(() => {
    const context = document.createElement("canvas").getContext("2d");
    const rgba = (color) => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      const values = [...context.getImageData(0, 0, 1, 1).data];
      return [...values.slice(0, 3), values[3] / 255];
    };
    const blend = (front, back, opacity = 1) =>
      front.slice(0, 3).map((value, i) => value * front[3] * opacity + back[i] * (1 - front[3] * opacity));
    const luminance = (rgb) =>
      rgb
        .slice(0, 3)
        .map((value) => value / 255)
        .map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4))
        .reduce((sum, value, i) => sum + value * [0.2126, 0.7152, 0.0722][i], 0);
    const contrast = (front, back) => {
      const [bright, dark] = [luminance(front), luminance(back)].sort((a, b) => b - a);
      return (bright + 0.05) / (dark + 0.05);
    };
    const background = (element) => {
      const ancestors = [];
      for (let node = element; node; node = node.parentElement) ancestors.unshift(node);
      return ancestors.reduce(
        (color, node) => blend(rgba(getComputedStyle(node).backgroundColor), color),
        [255, 255, 255],
      );
    };
    const opacity = (element) => {
      let value = 1;
      for (let node = element; node; node = node.parentElement)
        value *= Number(getComputedStyle(node).opacity);
      return value;
    };
    const visible = (element) =>
      element.checkVisibility({ checkVisibilityCSS: true }) && getComputedStyle(element).fontSize !== "0px";
    const text = [
      ".module-number",
      ".module-count",
      ".module-count small",
      ".module-caption",
      ".module-node strong",
      ".module-state",
      ".module-icon",
      ".tool-node strong",
      ".tool-status",
      ".tool-id",
      ".tool-duration",
      ".tool-stages > span",
      ".fleet-instrument .eyebrow",
      ".fleet-instrument > span",
      ".fleet-instrument strong",
      ".replay-readout strong",
      ".tool-pagination button[aria-pressed='true']",
      ".session-status",
      ".session-identity",
      ".session-filter-count",
      ".conceptual-note",
      ".event-copy small",
      ".event-copy strong",
    ].join(",");
    const graphics =
      ".wire,.module-trace i,.tool-stages i,.session-phase-track i,.map-legend i,.core-segment";
    const measurements = [
      [text, "color", 4.5],
      [graphics, null, 3],
    ].flatMap(([selector, property, minimum]) =>
      [...document.querySelectorAll(selector)].filter(visible).map((element) => {
        const style = getComputedStyle(element);
        const channel = property || (element instanceof SVGElement ? "stroke" : "backgroundColor");
        const back = background(channel === "backgroundColor" ? element.parentElement : element);
        return {
          name: `${element.parentElement.getAttribute("class")} / ${element.getAttribute("class")}`,
          text: element.textContent.trim().slice(0, 60),
          ratio: contrast(blend(rgba(style[channel]), back, opacity(element)), back),
          minimum,
        };
      }),
    );
    const clipping = [
      ...document.querySelectorAll(
        ".module-node strong,.tool-node strong,.tool-status,.tool-id,.tool-duration,.module-count,.fleet-instrument > *",
      ),
    ]
      .filter(visible)
      .flatMap((element) => {
        const node = element.closest(".module-node,.tool-node,.fleet-instrument").getBoundingClientRect();
        const rect = element.getBoundingClientRect();
        return rect.top < node.top - 1 ||
          rect.bottom > node.bottom + 1 ||
          (getComputedStyle(element).overflowY !== "visible" &&
            element.scrollHeight > element.clientHeight + 1)
          ? [element.textContent.trim()]
          : [];
      });
    const island = document.querySelector("#observatory-content");
    const controlOverflow = [...document.querySelectorAll(".replay-options button")]
      .filter(visible)
      .flatMap((element) => {
        const row = element.closest(".replay-options").getBoundingClientRect();
        const rect = element.getBoundingClientRect();
        return rect.left < row.left - 1 || rect.right > row.right + 1
          ? [element.getAttribute("aria-label") || element.textContent.trim()]
          : [];
      });
    return {
      measurements,
      clipping,
      controlOverflow,
      bounded:
        island.scrollWidth <= island.clientWidth + 1 &&
        (innerWidth < 1280 || island.scrollHeight <= island.clientHeight + 1),
    };
  });
  results.push({ label, ...result });
  const failures = result.measurements.filter((item) => item.ratio < item.minimum);
  assert.deepEqual(failures, [], `${label}: contrast`);
  assert.deepEqual(result.clipping, [], `${label}: card content clipped`);
  assert.deepEqual(result.controlOverflow, [], `${label}: replay control clipped`);
  assert.ok(result.bounded, `${label}: viewport overflow`);
}

try {
  const page = await browser.newPage({ viewport: { width: 1512, height: 982 } });
  page.setDefaultTimeout(15000);
  await page.goto("https://kite.dev.hexly.ai");
  await page.locator(".session-item").first().waitFor();
  for (const theme of ["dark", "light"]) {
    if ((await page.locator("html").getAttribute("data-mode")) !== theme)
      await page.getByRole("button", { name: "Change theme" }).click();
    await page.getByRole("button", { name: "All sessions", exact: true }).click();
    await inspect(page, `${theme}-overview`);
    for (const [width, height] of [
      [1280, 720],
      [390, 844],
    ]) {
      await page.setViewportSize({ width, height });
      await page.waitForTimeout(350);
      await inspect(page, `${theme}-overview-${width}`);
    }
    await page.setViewportSize({ width: 1512, height: 982 });
    await page.waitForTimeout(350);
    await page.getByRole("textbox", { name: "Search sessions" }).fill("kite");
    await page
      .getByRole("button", { name: /^Inspect kite / })
      .first()
      .click();
    await page.locator(".tool-node").first().waitFor();
    await inspect(page, `${theme}-recording`);
    for (const module of ["Provider", "Tools", "Response"]) {
      await page.getByRole("button", { name: `${module} module`, exact: true }).hover();
      await inspect(page, `${theme}-hover-${module.toLowerCase()}`);
    }
    await page.mouse.move(280, 60);
    await page.getByRole("button", { name: "From start", exact: true }).click();
    await inspect(page, `${theme}-current-hook`);
    await page.getByRole("button", { name: "Live", exact: true }).click();
    for (const [width, height] of [
      [1280, 720],
      [1366, 768],
      [1920, 1080],
      [320, 844],
      [390, 844],
    ]) {
      await page.setViewportSize({ width, height });
      await page.waitForTimeout(350);
      await inspect(page, `${theme}-${width}`);
      if (width === 320) {
        await page.getByRole("button", { name: "From start", exact: true }).click();
        await inspect(page, `${theme}-${width}-replay`);
        await page.getByRole("button", { name: "Live", exact: true }).click();
      }
    }
    await page.setViewportSize({ width: 1512, height: 982 });
    await page.waitForTimeout(350);
  }
  console.log(JSON.stringify({ status: "passed", states: results.length, screenshots: output }));
} finally {
  await writeFile(`${output}palette-verification.json`, JSON.stringify(results, null, 2));
  await browser.close();
}
