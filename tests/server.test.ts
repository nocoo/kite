import { chmodSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer, request } from "node:http";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_BATCH_BYTES } from "../src/schema.ts";
import { serve } from "../src/server.ts";
import { defaultDirectory, localRequest, socketPath } from "../src/transport.ts";
import { event } from "./fixtures.ts";

const dirs: string[] = [];
const closing: (() => Promise<void>)[] = [];
function directory() {
  const path = mkdtempSync("/tmp/kite-http-");
  dirs.push(path);
  return join(path, "state");
}
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  for (const close of closing.splice(0)) await close();
  for (const path of dirs.splice(0)) rmSync(path, { recursive: true });
});

describe("private Unix collector", () => {
  it("serves health, commits before ACK, queries and reopens durable storage", async () => {
    const dir = directory();
    let server = await serve(dir);
    closing.push(server.close);
    expect((await localRequest(server.socket, "/health")).body).toEqual({ ok: true, schemaVersion: 1 });
    expect(await localRequest(server.socket, "/v1/events", JSON.stringify([event()]))).toEqual({
      status: 200,
      body: { accepted: 1, inserted: 1 },
    });
    expect((await localRequest(server.socket, "/v1/events", JSON.stringify([event()]))).body).toEqual({
      accepted: 1,
      inserted: 0,
    });
    expect(
      (await localRequest(server.socket, "/v1/events?source=future-source&sessionId=s&limit=1&after=0")).body,
    ).toMatchObject({ events: [{ ...event(), cursor: 1 }] });
    for (const [path, mode] of [
      [dir, 0o700],
      [server.socket, 0o600],
      [join(dir, "events.sqlite"), 0o600],
    ] as const) {
      expect(statSync(path).mode & 0o777).toBe(mode);
    }
    await expect(serve(dir)).rejects.toThrow("already exists");
    await server.close();
    await server.close();
    server = await serve(dir);
    closing.push(server.close);
    expect(server.store.query()).toHaveLength(1);
  });
  it("rejects malformed, oversized and conflicting batches without partial insertion", async () => {
    const server = await serve(directory());
    closing.push(server.close);
    expect((await localRequest(server.socket, "/v1/events", "bad json")).status).toBe(400);
    expect((await localRequest(server.socket, "/v1/events", "[]")).status).toBe(400);
    expect((await localRequest(server.socket, "/v1/events", " ".repeat(MAX_BATCH_BYTES + 1))).status).toBe(
      413,
    );
    expect(
      (
        await localRequest(
          server.socket,
          "/v1/events",
          JSON.stringify([event(), { ...event(), name: "other" }]),
        )
      ).status,
    ).toBe(409);
    expect(server.store.query()).toEqual([]);
    expect((await localRequest(server.socket, "/v1/events?limit=-1")).status).toBe(400);
    expect((await localRequest(server.socket, "/missing")).status).toBe(404);
    expect((await localRequest(server.socket, "/missing", "{}")).status).toBe(404);
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const req = request({ socketPath: server.socket, path: "/v1/events", method: "POST" }, (res) => {
        res.resume();
        resolve(res.statusCode);
      });
      req.on("error", reject);
      req.end("[]");
    });
    expect(status).toBe(415);
    vi.spyOn(server.store, "append").mockImplementation(() => {
      throw new Error("private path");
    });
    expect(await localRequest(server.socket, "/v1/events", JSON.stringify([event()]))).toEqual({
      status: 500,
      body: { error: "Collector failure" },
    });
  });
  it("refuses insecure files and stale sockets without taking ownership", async () => {
    const dir = directory();
    mkdirSync(dir, { mode: 0o755 });
    await expect(serve(dir)).rejects.toThrow("private");
    chmodSync(dir, 0o700);
    const db = join(dir, "events.sqlite");
    writeFileSync(db, "", { mode: 0o644 });
    await expect(serve(dir)).rejects.toThrow("private regular file");
    chmodSync(db, 0o600);
    writeFileSync(join(dir, "collector.sock"), "owned elsewhere");
    await expect(serve(dir)).rejects.toThrow("already exists");
  });
  it("cleans up when the Unix socket path is too long", async () => {
    const dir = join(directory(), "x".repeat(100));
    await expect(serve(dir)).rejects.toThrow();
  });
});

describe("bounded local client", () => {
  it("resolves default and explicit socket locations", () => {
    vi.stubEnv("KITE_SOCKET", undefined);
    expect(socketPath()).toBe(join(defaultDirectory(), "collector.sock"));
    vi.stubEnv("KITE_SOCKET", "/tmp/custom");
    expect(socketPath()).toBe("/tmp/custom");
  });
  it.each(["malformed", "oversized", "deadline", "abort"])("handles %s responses", async (mode) => {
    const dir = directory();
    mkdirSync(dir, { mode: 0o700 });
    const path = join(dir, "test.sock");
    const server = createServer((_req, res) => {
      if (mode === "malformed") res.end("not json");
      else if (mode === "oversized") res.end("x".repeat(MAX_BATCH_BYTES * 8 + 1));
    });
    await new Promise<void>((resolve) => server.listen(path, resolve));
    closing.push(
      () =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
          server.closeAllConnections();
        }),
    );
    const controller = new AbortController();
    const pending = localRequest(path, "/", undefined, mode === "abort" ? controller.signal : undefined);
    if (mode === "abort") controller.abort();
    await expect(pending).rejects.toThrow();
  });
});
