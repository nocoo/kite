import { spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access, lstat, mkdir, mkdtemp, readdir, rm, symlink } from "node:fs/promises";
import { constants, tmpdir } from "node:os";
import path from "node:path";
import { verifyCoverageSummary } from "./verify-coverage-summary.mjs";

const LIMIT_MS = (() => {
  const fromEnv = Number(process.env.KITE_CHECK_INDEX_LIMIT_MS);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;
  return 120_000;
})();

/** @type {readonly [string, readonly string[]][]} */
const GATE_STEPS = [
  ["npx", ["biome", "check", "--error-on-warnings", "."]],
  ["npx", ["tsc", "--noEmit"]],
  ["npx", ["vitest", "run", "--coverage"]],
];
const CACHE_ENTRIES = new Set([".cache", ".vite"]);

let snapshot;
let active;
let aborted = 0;
let timedOut = false;
let cleanupPromise;

function exitCode(signalName) {
  return 128 + (constants.signals[signalName] ?? 1);
}

function killActive(signal) {
  const child = active;
  if (!child?.pid) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      // The child already exited.
    }
  }
}

function abort(signalName) {
  if (aborted || timedOut) return;
  aborted = exitCode(signalName);
  killActive("SIGTERM");
  setTimeout(() => killActive("SIGKILL"), 200);
  setTimeout(() => {
    void cleanup().finally(() => process.exit(aborted));
  }, 1000);
}

process.on("SIGINT", () => abort("SIGINT"));
process.on("SIGTERM", () => abort("SIGTERM"));
process.on("SIGHUP", () => abort("SIGHUP"));

function run(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      detached: true,
      stdio: options.stdio,
    });
    active = child;
    let settled = false;
    let stdout = "";
    let stderr = "";
    const finish = (settle) => {
      if (settled) return;
      settled = true;
      if (active === child) active = undefined;
      settle();
    };
    child.stdout?.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => finish(() => reject(error)));
    child.on("close", (code, signal) => finish(() => resolve({ code: code ?? 1, signal, stdout, stderr })));
  });
}

function statusOf(result) {
  if (aborted) return aborted;
  if (timedOut) return 124;
  if (result.signal) return exitCode(result.signal);
  return result.code === 0 ? 0 : result.code || 1;
}

function checkEnv(dir) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("GIT_")) delete env[key];
  }
  const childPath = process.env.KITE_CHECK_INDEX_CHILD_PATH;
  if (childPath) env.PATH = childPath;
  env.TMPDIR = dir;
  env.TMP = dir;
  env.TEMP = dir;
  env.XDG_CACHE_HOME = path.join(dir, ".cache");
  env.npm_config_cache = path.join(dir, ".npm-cache");
  env.npm_config_update_notifier = "false";
  return env;
}

async function dependenciesRoot(cwd) {
  const common = await run("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
    cwd,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const commonStatus = statusOf(common);
  if (commonStatus !== 0) return null;
  const commonDir = common.stdout.trim();
  if (!commonDir) return null;
  return path.dirname(commonDir);
}

async function assertTooling(repoRoot) {
  await access(path.join(repoRoot, "node_modules"), fsConstants.R_OK);
}

async function linkNodeModules(repoRoot, dir) {
  const dest = path.join(dir, "node_modules");
  try {
    await lstat(dest);
    return;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const source = path.join(repoRoot, "node_modules");
  try {
    await access(source, fsConstants.R_OK);
  } catch {
    throw new Error("node_modules is missing or not readable");
  }
  const stat = await lstat(source);
  if (!stat.isDirectory() && !stat.isSymbolicLink()) {
    throw new Error("node_modules is missing");
  }
  // Link entries, not the directory, so tool caches cannot write through into the repo.
  await mkdir(dest);
  const entries = await readdir(source);
  for (const name of entries) {
    if (CACHE_ENTRIES.has(name)) continue;
    await symlink(path.join(source, name), path.join(dest, name));
  }
}

async function cleanup() {
  killActive("SIGTERM");
  if (!cleanupPromise) {
    const dir = snapshot;
    snapshot = undefined;
    cleanupPromise = dir ? rm(dir, { recursive: true, force: true }) : Promise.resolve();
  }
  await cleanupPromise;
}

async function main() {
  let hardStop;
  const timer = setTimeout(() => {
    if (!aborted) timedOut = true;
    killActive("SIGTERM");
    setTimeout(() => killActive("SIGKILL"), 200);
    hardStop = setTimeout(() => {
      void cleanup().finally(() => process.exit(aborted || 124));
    }, 1000);
  }, LIMIT_MS);

  try {
    const root = await run("git", ["rev-parse", "--show-toplevel"], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const rootStatus = statusOf(root);
    if (rootStatus !== 0) {
      if (root.stderr) process.stderr.write(root.stderr);
      return rootStatus;
    }
    const workTreeRoot = root.stdout.trim();
    if (!workTreeRoot) return 1;

    const modulesRoot = (await dependenciesRoot(workTreeRoot)) || workTreeRoot;

    snapshot = await mkdtemp(path.join(tmpdir(), "kite-index-"));
    const prefix = snapshot.endsWith(path.sep) ? snapshot : `${snapshot}${path.sep}`;
    const exported = await run(
      "git",
      ["checkout-index", "--all", "--ignore-skip-worktree-bits", `--prefix=${prefix}`],
      {
        cwd: workTreeRoot,
        env: process.env,
        stdio: ["ignore", "ignore", "pipe"],
      },
    );
    const exportStatus = statusOf(exported);
    if (exportStatus !== 0) {
      if (exported.stderr) process.stderr.write(exported.stderr);
      return exportStatus;
    }

    await assertTooling(modulesRoot);
    await linkNodeModules(modulesRoot, snapshot);
    if (aborted || timedOut) return statusOf({ code: 1, signal: null });

    const env = checkEnv(snapshot);
    for (const [command, args] of GATE_STEPS) {
      const step = await run(command, args, {
        cwd: snapshot,
        env,
        stdio: "inherit",
      });
      const stepStatus = statusOf(step);
      if (stepStatus !== 0) return stepStatus;
      if (aborted || timedOut) return statusOf({ code: 1, signal: null });
    }

    const coverageStatus = await verifyCoverageSummary(snapshot);
    if (coverageStatus !== 0) return coverageStatus;
    if (aborted || timedOut) return statusOf({ code: 1, signal: null });
    return 0;
  } catch (error) {
    if (aborted) return aborted;
    if (timedOut) return 124;
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    return 1;
  } finally {
    clearTimeout(timer);
    clearTimeout(hardStop);
    await cleanup();
  }
}

const status = await main();
process.exit(status);
