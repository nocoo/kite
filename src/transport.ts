import { request } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import { MAX_BATCH_BYTES } from "./schema.ts";

export const defaultDirectory = () => join(homedir(), ".local", "state", "kite");
export const socketPath = () => process.env.KITE_SOCKET ?? join(defaultDirectory(), "collector.sock");

export function localRequest(
  socket: string,
  path: string,
  body?: string,
  signal?: AbortSignal,
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        socketPath: socket,
        path,
        agent: false,
        method: body === undefined ? "GET" : "POST",
        signal,
        headers:
          body === undefined
            ? {}
            : { "content-type": "application/json", "content-length": Buffer.byteLength(body) },
      },
      (res) => {
        const chunks: Buffer[] = [];
        let bytes = 0;
        res.on("data", (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > MAX_BATCH_BYTES * 8) {
            req.destroy(new Error("Response too large"));
            return;
          }
          chunks.push(chunk);
        });
        res.on("error", reject);
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode ?? 500, body: JSON.parse(Buffer.concat(chunks).toString()) });
          } catch {
            reject(new Error("Invalid collector response"));
          }
        });
      },
    );
    const timer = setTimeout(() => req.destroy(new Error("Collector deadline exceeded")), 1000);
    timer.unref();
    req.on("close", () => clearTimeout(timer));
    req.on("error", reject);
    req.on("socket", (socket) => {
      if (signal) socket.unref();
    });
    req.end(body);
  });
}
