import { createServer, type IncomingMessage, request, type ServerResponse } from "node:http";
import { afterEach, expect, it, vi } from "vitest";
import * as transport from "../src/transport.ts";
import { webApi } from "../src/web-api.ts";

const closes: (() => Promise<void>)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of closes.splice(0)) await close();
});
async function start() {
  const server = createServer((req, res) => {
    void webApi(req, res, () => {
      res.statusCode = 204;
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  closes.push(() => new Promise((resolve) => server.close(() => resolve())));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No listening port");
  return async (path: string, headers: Record<string, string> = { "x-kite-client": "1" }, method = "GET") =>
    new Promise<{ status: number; body: string; headers: Record<string, unknown> }>((resolve, reject) => {
      const req = request({ host: "127.0.0.1", port: address.port, path, method, headers }, (res) => {
        let body = "";
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body, headers: res.headers }));
      });
      req.on("error", reject);
      req.end();
    });
}
it("forwards only local read-only routes with no-store responses", async () => {
  const forward = vi
    .spyOn(transport, "localRequest")
    .mockResolvedValue({ status: 200, body: { events: [] } });
  const get = await start();
  expect((await get("/")).status).toBe(204);
  for (const [route, target] of [
    ["health", "/health"],
    ["events?after=8", "/v1/events?after=8"],
    ["sessions", "/v1/sessions"],
  ]) {
    const result = await get(`/api/${route}`);
    expect(result.status).toBe(200);
    expect(JSON.parse(result.body)).toEqual({ events: [] });
    expect(result.headers["cache-control"]).toBe("no-store");
    expect(result.headers["access-control-allow-origin"]).toBeUndefined();
    expect(forward).toHaveBeenLastCalledWith(transport.socketPath(), target);
  }
  expect((await get("/api/nope")).status).toBe(404);
  expect((await get("/api/events", { "x-kite-client": "1" }, "POST")).status).toBe(405);
});
it("rejects cross-origin, spoofed hosts and missing client headers", async () => {
  const forward = vi
    .spyOn(transport, "localRequest")
    .mockResolvedValue({ status: 400, body: { error: "Bad cursor" } });
  const get = await start();
  for (const headers of [
    {},
    { host: "evil.test", "x-kite-client": "1" },
    { origin: "https://evil.test", "x-kite-client": "1" },
    { "sec-fetch-site": "cross-site", "x-kite-client": "1" },
  ] as Record<string, string>[]) {
    expect((await get("/api/events", headers)).status).toBe(403);
  }
  expect(forward).not.toHaveBeenCalled();
  const result = await get("/api/events", {
    host: "kite.dev.hexly.ai",
    origin: "https://kite.dev.hexly.ai",
    "sec-fetch-site": "same-origin",
    "x-kite-client": "1",
  });
  expect(result.status).toBe(400);
  expect(JSON.parse(result.body)).toEqual({ error: "Bad cursor" });
  expect((await get("/api/events", { origin: "invalid", "x-kite-client": "1" })).status).toBe(503);
  forward.mockRejectedValue(new Error("ENOENT"));
  expect((await get("/api/events")).status).toBe(503);
});
it("passes requests without a URL to the next handler", async () => {
  const next = vi.fn();
  await webApi({} as IncomingMessage, {} as ServerResponse, next);
  expect(next).toHaveBeenCalledOnce();
});
