import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const MIN_PCT = 95;
const METRICS = ["lines", "statements", "functions", "branches"];

/**
 * @param {string} [cwd]
 * @returns {Promise<number>}
 */
export async function verifyCoverageSummary(cwd = process.cwd()) {
  const summaryPath = path.join(cwd, "coverage", "coverage-summary.json");
  let raw;
  try {
    raw = await readFile(summaryPath, "utf8");
  } catch {
    console.error(`Missing coverage summary at ${summaryPath}`);
    return 1;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.error("Could not parse coverage/coverage-summary.json");
    return 1;
  }

  const total = parsed?.total;
  if (!total || typeof total !== "object") {
    console.error("Coverage summary is missing a total section");
    return 1;
  }

  for (const metric of METRICS) {
    const pct = total[metric]?.pct;
    if (typeof pct !== "number" || Number.isNaN(pct) || pct < MIN_PCT) {
      console.error(`Coverage ${metric} is ${pct ?? "missing"}% (required >= ${MIN_PCT}%)`);
      return 1;
    }
  }

  return 0;
}

const self = pathToFileURL(process.argv[1]).href;
if (import.meta.url === self) {
  const status = await verifyCoverageSummary();
  process.exit(status);
}
