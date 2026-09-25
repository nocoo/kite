import type { IncomingMessage, ServerResponse } from "node:http";
import { localRequest, socketPath } from "./transport.ts";

const hosts = new Set(["kite.dev.hexly.ai", "127.0.0.1", "localhost", "[::1]"]);

export async function webApi(req: IncomingMessage, res: ServerResponse, next: () => void): Promise<void> {
  if (!req.url?.startsWith("/api/")) return next();
  res.setHeader("cache-control", "no-store");
  res.setHeader("content-type", "application/json");
  res.setHeader("x-content-type-options", "nosniff");
  const send = (status: number, value: unknown) => {
    res.statusCode = status;
    res.end(JSON.stringify(value));
  };
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const origin = req.headers.origin;
    if (
      !hosts.has(url.hostname) ||
      req.headers["x-kite-client"] !== "1" ||
      (req.headers["sec-fetch-site"] && req.headers["sec-fetch-site"] !== "same-origin") ||
      (origin && new URL(origin).host !== url.host)
    ) {
      send(403, { error: "Local same-origin client required" });
      return;
    }
    if (req.method !== "GET") {
      send(405, { error: "Read-only API" });
      return;
    }
    const routes: Record<string, string> = {
      "/api/health": "/health",
      "/api/events": "/v1/events",
      "/api/sessions": "/v1/sessions",
    };
    const path = routes[url.pathname];
    if (!path) {
      send(404, { error: "Not found" });
      return;
    }
    const result = await localRequest(socketPath(), path + url.search);
    send(result.status, result.body);
  } catch {
    send(503, { error: "Collector unavailable. Start the local Kite collector." });
  }
}
