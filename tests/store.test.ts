import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { InputError, MAX_EVENT_BYTES, validateBatch, validateEvent } from "../src/schema.ts";
import { EventStore } from "../src/store.ts";

import { event } from "./fixtures.ts";

const directories: string[] = [];
afterEach(() => {
  for (const path of directories.splice(0)) rmSync(path, { recursive: true });
});

describe("neutral validation", () => {
  it("accepts JSON and future event names without a Pi enum", () => {
    expect(validateEvent({ ...event(), payload: [null, false, 1, "text", {}, []] })).toBeTruthy();
    expect(validateEvent({ ...event(), correlation: undefined, payload: Object.create(null) })).toBeTruthy();
    expect(validateBatch([event()])).toHaveLength(1);
  });
  it.each([
    null,
    [],
    3,
    {},
    { ...event(), source: "" },
    { ...event(), name: "x".repeat(257) },
    { ...event(), producerId: 1 },
    { ...event(), schemaVersion: 2 },
    { ...event(), seq: 0 },
    { ...event(), seq: 1.5 },
    { ...event(), seq: Number.MAX_SAFE_INTEGER + 1 },
    { ...event(), timestamp: "1" },
    { ...event(), timestamp: -1 },
    { ...event(), timestamp: Infinity },
    { ...event(), monotonicMs: "1" },
    { ...event(), monotonicMs: -1 },
    { ...event(), monotonicMs: NaN },
    { ...event(), correlation: [] },
    { ...event(), correlation: { bad: null } },
    { ...event(), correlation: { ["x".repeat(129)]: 1 } },
    { ...event(), correlation: { big: "x".repeat(1025) } },
    { ...event(), correlation: { n: Infinity } },
    { ...event(), correlation: Object.fromEntries(Array.from({ length: 33 }, (_, i) => [String(i), i])) },
    { ...event(), payload: undefined },
    { ...event(), payload: Infinity },
    { ...event(), payload: new Date() },
    { ...event(), payload: "x".repeat(MAX_EVENT_BYTES) },
  ])("rejects malformed input", (input) => {
    expect(() => validateEvent(input)).toThrow(InputError);
  });
  it("bounds deep/cyclic and wide structures", () => {
    const cycle: unknown[] = [];
    cycle.push(cycle);
    expect(() => validateEvent({ ...event(), payload: cycle })).toThrow("structural");
    expect(() => validateEvent({ ...event(), payload: Array(20001).fill(0) })).toThrow("structural");
    expect(validateEvent({ ...event(), correlation: { turn: 0 } })).toBeTruthy();
  });
  it.each([null, [], Array(129).fill(event())])("bounds batch count", (input) => {
    expect(() => validateBatch(input)).toThrow(InputError);
  });
});

describe("transactional event store", () => {
  it("paginates large records by bytes without skipping the next cursor", () => {
    const store = new EventStore(":memory:");
    store.append(Array.from({ length: 80 }, (_, i) => ({ ...event(i + 1), payload: "x".repeat(64000) })));
    const first = store.query({ limit: 1000 });
    expect(first.length).toBeLessThan(80);
    expect(Buffer.byteLength(JSON.stringify(first))).toBeLessThan(4 * 1024 * 1024);
    const next = store.query({ after: first.at(-1)?.cursor, limit: 1000 });
    expect([...first, ...next].map((item) => item.seq)).toEqual(Array.from({ length: 80 }, (_, i) => i + 1));
    store.close();
  });
  it("commits, deduplicates, paginates and survives restart", () => {
    const dir = mkdtempSync(join(tmpdir(), "kite-store-"));
    directories.push(dir);
    const path = join(dir, "events.sqlite");
    let store = new EventStore(path);
    expect(store.append([event(), event(2)])).toEqual({ accepted: 2, inserted: 2 });
    expect(store.append([event()])).toEqual({ accepted: 1, inserted: 0 });
    expect(store.query({ limit: 1 })[0]).toMatchObject({ ...event(), cursor: 1 });
    expect(store.query({ after: 1, sessionId: "s", source: "future-source" })).toHaveLength(1);
    expect(store.query({ source: "other" })).toEqual([]);
    const saved = store.query();
    store.close();
    store = new EventStore(path);
    expect(store.query()).toEqual(saved);
    store.close();
  });
  it("rolls back earlier inserts when any identity conflicts", () => {
    const store = new EventStore(":memory:");
    store.append([event()]);
    expect(() => store.append([event(2), { ...event(), name: "conflict" }])).toThrow("conflict");
    expect(store.query()).toHaveLength(1);
    expect(() => store.append([event(2), { ...event(3), seq: -1 }])).toThrow(InputError);
    expect(store.query()).toHaveLength(1);
    store.append([{ ...event(2), correlation: undefined }]);
    expect(store.query({ sessionId: "" })).toHaveLength(1);
    store.close();
  });
  it("rejects conflicts inside a single batch", () => {
    const store = new EventStore(":memory:");
    expect(() => store.append([event(), { ...event(), name: "other" }])).toThrow("conflict");
    expect(store.query()).toEqual([]);
    store.close();
  });
  it.each([{ after: -1 }, { after: 0.1 }, { limit: 0 }, { limit: 1001 }, { limit: 1.5 }])(
    "validates queries",
    (query) => {
      const store = new EventStore(":memory:");
      expect(() => store.query(query)).toThrow(InputError);
      store.close();
    },
  );
});
