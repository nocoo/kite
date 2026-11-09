import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const POSITIVE_MAX_MS = 120_000;

/** @typedef {{ name: string; expectCode: number | "nonzero"; env?: NodeJS.ProcessEnv; signalAfterMs?: number; apply?: (dir: string) => Promise<void> }} Scenario */

/**
 * @param {string} command
 * @param {string[]} args
 * @param {{ cwd?: string; env?: NodeJS.ProcessEnv; stdio?: import("node:child_process").StdioOptions }} [options]
 */
function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: options.stdio ?? ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => reject(error));
    child.on("close", (code, signal) => resolve({ code: code ?? 1, signal, stdout, stderr }));
  });
}

async function repoRoot() {
  const result = await run("git", ["rev-parse", "--show-toplevel"], { cwd: SCRIPT_DIR });
  if (result.code !== 0) throw new Error(`git rev-parse failed: ${result.stderr}`);
  return result.stdout.trim();
}

/**
 * @param {string} worktreeCwd
 * @param {string} mainRoot
 * @param {NodeJS.ProcessEnv} [extraEnv]
 */
async function runCheckIndex(worktreeCwd, mainRoot, extraEnv = {}) {
  const script = path.join(mainRoot, "scripts/check-index.mjs");
  const started = Date.now();
  const result = await run("node", [script], {
    cwd: worktreeCwd,
    env: { ...process.env, ...extraEnv },
    stdio: "inherit",
  });
  return { ...result, durationMs: Date.now() - started };
}

/**
 * @param {string} worktreeCwd
 * @param {string} mainRoot
 * @param {NodeJS.ProcessEnv} [extraEnv]
 * @param {number} [signalAfterMs]
 */
async function runCheckIndexWithSignal(worktreeCwd, mainRoot, extraEnv = {}, signalAfterMs = 800) {
  const script = path.join(mainRoot, "scripts/check-index.mjs");
  return new Promise((resolve, reject) => {
    const child = spawn("node", [script], {
      cwd: worktreeCwd,
      env: { ...process.env, ...extraEnv },
      stdio: "inherit",
      detached: true,
    });
    child.on("error", reject);
    const timer = setTimeout(() => {
      try {
        process.kill(-child.pid, "SIGINT");
      } catch {
        child.kill("SIGINT");
      }
    }, signalAfterMs);
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, signal });
    });
  });
}

/**
 * @param {string} dir
 * @param {string} file
 * @param {string} content
 */
async function stageFile(dir, file, content) {
  const target = path.join(dir, file);
  await writeFile(target, content, "utf8");
  const add = await run("git", ["add", file], { cwd: dir });
  if (add.code !== 0) throw new Error(`git add failed for ${file}: ${add.stderr}`);
}

/** @type {Scenario[]} */
const SCENARIOS = [
  {
    name: "healthy-index",
    expectCode: 0,
    async apply() {},
  },
  {
    name: "ut-failure",
    expectCode: "nonzero",
    async apply(dir) {
      await stageFile(
        dir,
        "tests/l1-probe-ut-fail.test.ts",
        'import { describe, expect, it } from "vitest";\n\ndescribe("l1 probe", () => {\n  it("fails", () => expect(1).toBe(2));\n});\n',
      );
    },
  },
  {
    name: "coverage-below-threshold",
    expectCode: "nonzero",
    async apply(dir) {
      const configPath = path.join(dir, "vitest.config.ts");
      let config = await readFile(configPath, "utf8");
      config = config.replace("statements: 95", "statements: 100");
      config = config.replace("branches: 95", "branches: 100");
      config = config.replace("functions: 95", "functions: 100");
      config = config.replace("lines: 95", "lines: 100");
      await stageFile(dir, "vitest.config.ts", config);
    },
  },
  {
    name: "lint-error",
    expectCode: "nonzero",
    async apply(dir) {
      const schemaPath = path.join(dir, "src/schema.ts");
      const original = await readFile(schemaPath, "utf8");
      await stageFile(dir, "src/schema.ts", `${original}\nexport const l1LintError = { broken = true };\n`);
    },
  },
  {
    name: "lint-warning",
    expectCode: "nonzero",
    async apply(dir) {
      const schemaPath = path.join(dir, "src/schema.ts");
      const original = await readFile(schemaPath, "utf8");
      await stageFile(
        dir,
        "src/schema.ts",
        `${original}\nexport const l1LintWarn = () => { console.log("l1"); };\n`,
      );
    },
  },
  {
    name: "type-error",
    expectCode: "nonzero",
    async apply(dir) {
      const schemaPath = path.join(dir, "src/schema.ts");
      const original = await readFile(schemaPath, "utf8");
      await stageFile(
        dir,
        "src/schema.ts",
        `${original}\nexport const l1TypeError: number = "not-a-number";\n`,
      );
    },
  },
  {
    name: "focused-test-only",
    expectCode: "nonzero",
    async apply(dir) {
      await stageFile(
        dir,
        "tests/l1-probe-only.test.ts",
        'import { describe, expect, it } from "vitest";\n\ndescribe("l1 only", () => {\n  it.only("focused", () => expect(true).toBe(true));\n});\n',
      );
    },
  },
  {
    name: "bad-staged-good-worktree",
    expectCode: "nonzero",
    async apply(dir) {
      const schemaPath = path.join(dir, "src/schema.ts");
      const original = await readFile(schemaPath, "utf8");
      await stageFile(dir, "src/schema.ts", `${original}\nexport const l1StagedBad: number = "bad";\n`);
      await writeFile(schemaPath, original, "utf8");
    },
  },
  {
    name: "gate-timeout",
    expectCode: 124,
    env: { KITE_CHECK_INDEX_LIMIT_MS: "800" },
    async apply() {},
  },
  {
    name: "gate-interrupted",
    expectCode: "nonzero",
    signalAfterMs: 900,
    async apply() {},
  },
  {
    name: "missing-tool-path",
    expectCode: "nonzero",
    env: { KITE_CHECK_INDEX_CHILD_PATH: "/usr/bin:/bin" },
    async apply() {},
  },
  {
    name: "missing-coverage-summary",
    expectCode: "nonzero",
    async apply(dir) {
      const configPath = path.join(dir, "vitest.config.ts");
      let config = await readFile(configPath, "utf8");
      config = config.replace('reporter: ["text", "json-summary"]', 'reporter: ["text"]');
      await stageFile(dir, "vitest.config.ts", config);
    },
  },
];

/**
 * @param {number | "nonzero"} expectCode
 * @param {number | null} actual
 */
function matchesExpectation(expectCode, actual) {
  if (expectCode === "nonzero") return actual !== 0;
  return actual === expectCode;
}

async function withWorktree(root, fn) {
  const dir = await mkdtemp(path.join(tmpdir(), "kite-l1-hook-"));
  const added = await run("git", ["worktree", "add", "--detach", dir, "HEAD"], { cwd: root });
  if (added.code !== 0) {
    await rm(dir, { recursive: true, force: true });
    throw new Error(`git worktree add failed: ${added.stderr}`);
  }
  try {
    return await fn(dir);
  } finally {
    const removed = await run("git", ["worktree", "remove", "--force", dir], { cwd: root });
    if (removed.code !== 0) {
      console.error(`worktree cleanup failed for ${dir}: ${removed.stderr}`);
    }
  }
}

async function main() {
  const root = await repoRoot();
  const failures = [];
  let healthyDurationMs;

  for (const scenario of SCENARIOS) {
    process.stdout.write(`scenario ${scenario.name} … `);
    try {
      await withWorktree(root, async (dir) => {
        if (scenario.apply) await scenario.apply(dir);
        let result;
        if (scenario.signalAfterMs) {
          result = await runCheckIndexWithSignal(dir, root, scenario.env ?? {}, scenario.signalAfterMs);
        } else {
          result = await runCheckIndex(dir, root, scenario.env ?? {});
        }
        const code = result.code ?? 1;
        if (!matchesExpectation(scenario.expectCode, code)) {
          failures.push(`${scenario.name}: expected ${scenario.expectCode}, got ${code}`);
          console.log("FAIL");
        } else {
          console.log("ok");
        }
        if (scenario.name === "healthy-index") {
          healthyDurationMs = result.durationMs;
          if (healthyDurationMs > POSITIVE_MAX_MS) {
            failures.push(`healthy-index: ${healthyDurationMs}ms exceeds ${POSITIVE_MAX_MS}ms budget`);
          }
        }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${scenario.name}: ${message}`);
      console.log("ERROR");
    }
  }

  if (failures.length) {
    console.error("\nL1 hook self-test failures:");
    for (const line of failures) console.error(`  - ${line}`);
    process.exit(1);
  }

  console.log(
    `\nL1 hook self-test passed (${SCENARIOS.length} scenarios). Healthy gate duration: ${((healthyDurationMs ?? 0) / 1000).toFixed(1)}s.`,
  );
}

await main();
