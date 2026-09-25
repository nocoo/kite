import { chmodSync, closeSync, existsSync, lstatSync, mkdirSync, openSync } from "node:fs";
import { createServer, type ServerResponse } from "node:http";
import { join } from "node:path";
import packageInfo from "../package.json" with { type: "json" };
import { ConflictError, InputError, MAX_BATCH_BYTES } from "./schema.ts";
import { EventStore } from "./store.ts";

function privateFile(path: string): void {
  if (!existsSync(path)) closeSync(openSync(path, "wx", 0o600));
  const stat = lstatSync(path);
  if (!stat.isFile() || (stat.mode & 0o077) !== 0) throw new Error("Database must be a private regular file");
}

export async function serve(directory: string) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stat = lstatSync(directory);
  if (!stat.isDirectory() || (stat.mode & 0o077) !== 0) throw new Error("Storage directory must be private");
  const socket = join(directory, "collector.sock");
  if (existsSync(socket)) throw new Error("Collector socket already exists");
  const path = join(directory, "events.sqlite");
  privateFile(path);
  const store = new EventStore(path);
  let timer: ReturnType<typeof setInterval> | undefined;
  const send = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  const server = createServer({ requestTimeout: 5000, headersTimeout: 5000 }, async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (req.method === "GET" && url.pathname === "/health") {
        send(res, 200, { ok: true, version: packageInfo.version, schemaVersion: 1 });
        return;
      }
      if (req.method === "GET" && url.pathname === "/v1/events") {
        const before = url.searchParams.get("before");
        const tail = url.searchParams.get("tail");
        if (tail !== null && tail !== "0" && tail !== "1") throw new InputError("Invalid tail");
        const events = store.query({
          after: Number(url.searchParams.get("after") ?? 0),
          ...(before === null ? {} : { before: Number(before) }),
          limit: Number(url.searchParams.get("limit") ?? 100),
          source: url.searchParams.get("source") ?? undefined,
          sessionId: url.searchParams.get("sessionId") ?? undefined,
          producerId: url.searchParams.get("producerId") ?? undefined,
          ...(tail === null ? {} : { tail: tail === "1" }),
        });
        send(res, 200, { events });
        return;
      }
      if (req.method === "GET" && url.pathname === "/v1/sessions") {
        const before = url.searchParams.get("before");
        send(
          res,
          200,
          store.sessions({
            limit: Number(url.searchParams.get("limit") ?? 100),
            ...(before === null ? {} : { before: Number(before) }),
          }),
        );
        return;
      }
      if (req.method !== "POST" || url.pathname !== "/v1/events") {
        send(res, 404, { error: "Not found" });
        return;
      }
      if (req.headers["content-type"] !== "application/json") {
        send(res, 415, { error: "Expected application/json" });
        return;
      }
      let size = 0;
      const chunks: Buffer[] = [];
      req.setTimeout(5000, () => req.destroy());
      for await (const chunk of req) {
        size += chunk.length;
        if (size > MAX_BATCH_BYTES) {
          send(res, 413, { error: "Batch too large" });
          return;
        }
        chunks.push(chunk);
      }
      let input: unknown;
      try {
        input = JSON.parse(Buffer.concat(chunks).toString());
      } catch {
        throw new InputError("Invalid JSON");
      }
      send(res, 200, store.append(input));
    } catch (error) {
      send(res, error instanceof InputError ? 400 : error instanceof ConflictError ? 409 : 500, {
        error:
          error instanceof InputError || error instanceof ConflictError ? error.message : "Collector failure",
      });
    }
  });
  try {
    store.prune();
    timer = setInterval(
      () => {
        try {
          store.prune();
        } catch {
          // A failed scheduled prune must leave the collector accepting events.
        }
      },
      60 * 60 * 1000,
    );
    timer.unref();
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(socket, resolve);
    });
    chmodSync(socket, 0o600);
  } catch (error) {
    if (timer) clearInterval(timer);
    server.close();
    store.close();
    throw error;
  }
  let closed: Promise<void> | undefined;
  return {
    socket,
    store,
    close: () => {
      closed ??= new Promise<void>((resolve) => {
        if (timer) clearInterval(timer);
        server.close(() => {
          store.close();
          resolve();
        });
        server.closeAllConnections();
      });
      return closed;
    },
  };
}
