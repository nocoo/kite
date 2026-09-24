import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { main, run } from "../src/cli.ts";
import { localRequest } from "../src/transport.ts";
import { event } from "./fixtures.ts";

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

describe("local collector CLI", () => {
  it("shows help and rejects invalid commands and options", async () => {
    const output = vi.fn();
    await main([], output);
    await main(["--help"], output);
    expect(output).toHaveBeenCalledTimes(2);
    for (const args of [
      ["unknown"],
      ["events", "--bad", "x"],
      ["events", "--dir"],
      ["events", "--dir", "a", "--dir", "b"],
      ["serve", "--limit", "1"],
    ]) {
      await expect(main(args, output)).rejects.toThrow();
    }
  });
  it("serves, filters pages, exports JSONL and reports query errors", async () => {
    const root = mkdtempSync("/tmp/kite-cli-");
    const dir = join(root, "state");
    const output = vi.fn();
    const close = await main(["serve", "--dir", dir], output);
    try {
      await localRequest(join(dir, "collector.sock"), "/v1/events", JSON.stringify([event(), event(2)]));
      output.mockClear();
      await main(
        [
          "events",
          "--dir",
          dir,
          "--after",
          "1",
          "--limit",
          "1",
          "--session",
          "s",
          "--source",
          "future-source",
        ],
        output,
      );
      expect(JSON.parse(output.mock.calls[0]?.[0] ?? "{}").events).toHaveLength(1);
      output.mockClear();
      await main(["export", "--dir", dir, "--limit", "1"], output);
      expect(output).toHaveBeenCalledTimes(2);
      expect(JSON.parse(output.mock.calls[1]?.[0] ?? "{}").seq).toBe(2);
      await expect(main(["events", "--dir", dir, "--limit", "-1"], output)).rejects.toThrow("Query failed");
    } finally {
      await close?.();
      rmSync(root, { recursive: true });
    }
  });
  it("sets failure status without leaking errors and closes on a signal", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await run(["help"]);
    expect(log).toHaveBeenCalled();
    await run(["unknown"]);
    expect(error).toHaveBeenCalledWith("Unknown command");
    expect(process.exitCode).toBe(1);
    const root = mkdtempSync("/tmp/kite-cli-");
    const before = new Set(process.listeners("SIGINT"));
    await run(["serve", "--dir", join(root, "state")]);
    const handler = process.listeners("SIGINT").find((listener) => !before.has(listener));
    if (!handler) throw new Error("missing signal handler");
    handler("SIGINT");
    await new Promise((resolve) => setImmediate(resolve));
    process.removeListener("SIGINT", handler);
    process.removeListener("SIGTERM", handler);
    rmSync(root, { recursive: true });
  });
});
