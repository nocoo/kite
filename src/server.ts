import { chmodSync, closeSync, existsSync, lstatSync, mkdirSync, openSync } from "node:fs";
import { createServer, type ServerResponse } from "node:http";
import { join } from "node:path";
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
  const send = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  const server = createServer({ requestTimeout: 5000, headersTimeout: 5000 }, async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (req.method === "GET" && url.pathname === "/health") {
        send(res, 200, { ok: true, schemaVersion: 1 });
        return;
      }
      if (req.method === "GET" && url.pathname === "/v1/events") {
        const events = store.query({
          after: Number(url.searchParams.get("after") ?? 0),
          limit: Number(url.searchParams.get("limit") ?? 100),
          source: url.searchParams.get("source") ?? undefined,
          sessionId: url.searchParams.get("sessionId") ?? undefined,
        });
        send(res, 200, { events });
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
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(socket, resolve);
    });
    chmodSync(socket, 0o600);
  } catch (error) {
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
