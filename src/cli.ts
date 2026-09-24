#!/usr/bin/env node
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isRecord } from "./schema.ts";
import { serve } from "./server.ts";
import { defaultDirectory, localRequest } from "./transport.ts";

export async function main(
  args: string[],
  output: (text: string) => void = console.log,
): Promise<(() => Promise<void>) | undefined> {
  const [command = "help", ...options] = args;
  if (command === "help" || command === "--help") {
    output("kite serve|events|export [--dir PATH] [--after N] [--limit N] [--session ID] [--source NAME]");
    return;
  }
  if (!["serve", "events", "export"].includes(command)) throw new Error("Unknown command");
  const flags = new Map<string, string>();
  for (let i = 0; i < options.length; i += 2) {
    const key = options[i],
      value = options[i + 1];
    if (
      !key ||
      !["--dir", "--after", "--limit", "--session", "--source"].includes(key) ||
      !value ||
      flags.has(key)
    ) {
      throw new Error("Invalid options");
    }
    flags.set(key, value);
  }
  const directory = resolve(flags.get("--dir") ?? defaultDirectory());
  if (command === "serve") {
    if (flags.size > Number(flags.has("--dir"))) throw new Error("Query flags are not valid for serve");
    const collector = await serve(directory);
    output(JSON.stringify({ socket: collector.socket }));
    return collector.close;
  }
  const params = new URLSearchParams({
    after: flags.get("--after") ?? "0",
    limit: flags.get("--limit") ?? "100",
  });
  if (flags.has("--session")) params.set("sessionId", flags.get("--session") as string);
  if (flags.has("--source")) params.set("source", flags.get("--source") as string);
  for (;;) {
    const response = await localRequest(`${directory}/collector.sock`, `/v1/events?${params}`);
    if (response.status !== 200 || !isRecord(response.body) || !Array.isArray(response.body.events))
      throw new Error("Query failed");
    if (command === "events") {
      output(JSON.stringify(response.body));
      return;
    }
    const events = response.body.events;
    if (events.length === 0) return;
    for (const event of events) output(JSON.stringify(event));
    params.set("after", String(events[events.length - 1].cursor));
  }
}

export async function run(args: string[]): Promise<void> {
  try {
    const close = await main(args);
    if (close) {
      const shutdown = () => {
        void close().catch(() => {
          process.exitCode = 1;
        });
      };
      process.once("SIGINT", shutdown);
      process.once("SIGTERM", shutdown);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Collector failed");
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await run(process.argv.slice(2));
