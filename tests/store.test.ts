import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
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
    expect(store.sessions().sessions[0]?.eventCount).toBe(2);
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
    expect(store.sessions().sessions).toMatchObject([{ eventCount: 1, lastEvent: "anything" }]);
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
  it.each([
    { after: -1 },
    { after: 0.1 },
    { limit: 0 },
    { limit: 1001 },
    { limit: 1.5 },
    { before: -1 },
    { before: 1.2 },
  ])("validates queries", (query) => {
    const store = new EventStore(":memory:");
    expect(() => store.query(query)).toThrow(InputError);
    store.close();
  });
  it("keeps the retention boundary, isolates producers, and pages session summaries", () => {
    const day = 24 * 60 * 60 * 1000;
    const start = 1_700_000_000_000;
    const now = vi.spyOn(Date, "now");
    const store = new EventStore(":memory:");
    now.mockReturnValue(start);
    const base = event();
    store.append([{ ...base, producerId: "old", seq: 1 }]);
    now.mockReturnValue(start + 10);
    store.append([
      {
        ...base,
        seq: 1,
        producerId: "resume",
        correlation: { sessionId: "s", model: "first", provider: 1 },
        payload: { cwd: 12, model: "payload-model" },
      },
      {
        ...base,
        seq: 2,
        producerId: "resume",
        name: "tool_execution_start",
        correlation: { sessionId: "s", model: "m1", provider: "p1" },
        payload: { cwd: "/work/kite" },
      },
      {
        ...base,
        seq: 3,
        producerId: "resume",
        name: "tool_execution_end",
        correlation: { sessionId: "s" },
        payload: { isError: true, cwd: "/later" },
      },
      {
        ...base,
        seq: 4,
        producerId: "resume",
        name: "tool_execution_end",
        correlation: { sessionId: "s", provider: "p2" },
        payload: { isError: false },
      },
      {
        ...base,
        seq: 5,
        producerId: "resume",
        name: "kite.delivery_loss",
        correlation: { sessionId: "s" },
        payload: { dropped: 4 },
      },
      {
        ...base,
        seq: 6,
        producerId: "resume",
        name: "message_update",
        correlation: { sessionId: "s" },
        payload: { cwd: null },
      },
      {
        ...base,
        seq: 7,
        producerId: "resume",
        name: "session_shutdown",
        correlation: { sessionId: "s" },
        payload: {},
      },
      { ...base, seq: 8, producerId: "other", source: "other-source", correlation: { sessionId: 7 } },
      { ...base, seq: 9, producerId: "blank", correlation: undefined, name: "input" },
    ]);
    now.mockReturnValue(start + 7 * day);
    expect(store.query({ producerId: "old" })).toHaveLength(1);
    expect(store.query()).toHaveLength(10);
    now.mockReturnValue(start + 7 * day + 1);
    expect(store.query({ producerId: "old" })).toEqual([]);
    expect(store.sessions().sessions.map((item) => item.producerId)).not.toContain("old");
    now.mockReturnValue(start);
    expect(store.query({ producerId: "old" })).toHaveLength(1);
    expect(store.prune(start + 7 * day)).toBe(0);
    expect(store.prune(start + 7 * day + 1)).toBe(1);
    expect(store.query({ producerId: "old" })).toEqual([]);

    now.mockReturnValue(start + 10);
    const resume = store.query({ producerId: "resume" });
    const upper = resume.find((item) => item.seq === 4)?.cursor ?? 0;
    expect(store.query({ producerId: "resume", after: 0, before: upper }).map((item) => item.seq)).toEqual([
      1, 2, 3, 4,
    ]);
    expect(store.query({ producerId: "resume", after: upper, before: upper })).toEqual([]);
    expect(store.query({ source: "other-source", sessionId: "7" })).toHaveLength(1);
    const page = store.sessions({ limit: 2 });
    expect(page.retentionDays).toBe(7);
    expect(page.sessions.map((item) => item.producerId)).toEqual(["blank", "other"]);
    expect(page.nextBefore).toBe(page.sessions[1]?.lastCursor);
    const next = store.sessions({ limit: 2, before: page.nextBefore ?? 0 });
    expect(next.sessions.map((item) => item.producerId)).toEqual(["resume"]);
    expect(next.nextBefore).toBeNull();
    expect(next.sessions[0]).toMatchObject({
      source: "future-source",
      sessionId: "s",
      producerId: "resume",
      eventCount: 7,
      cwd: "/later",
      model: "m1",
      provider: "p2",
      lastEvent: "session_shutdown",
      lastLifecycle: "session_shutdown",
      lastActivity: "message_update",
      toolCount: 1,
      errorCount: 1,
      lossCount: 1,
    });
    expect(store.sessions().sessions.find((item) => item.producerId === "blank")).toMatchObject({
      sessionId: "",
      cwd: null,
      model: null,
      provider: null,
      lastLifecycle: null,
      lastActivity: "input",
      toolCount: 0,
      errorCount: 0,
      lossCount: 0,
    });
    expect(store.sessions().sessions.find((item) => item.producerId === "other")).toMatchObject({
      source: "other-source",
      sessionId: "7",
      cwd: null,
      model: null,
      provider: null,
    });
    expect(() => store.sessions({ limit: 201 })).toThrow(InputError);
    expect(() => store.sessions({ limit: 0 })).toThrow(InputError);
    expect(() => store.sessions({ before: -1 })).toThrow(InputError);
    expect(store.sessions({ before: 0 }).sessions).toEqual([]);
    now.mockReturnValue(start + 20);
    store.append([
      {
        ...base,
        seq: 1,
        producerId: "mixed",
        name: "tool_execution_start",
        payload: { cwd: "/expired" },
      },
    ]);
    now.mockReturnValue(start + 7 * day);
    store.append([
      {
        ...base,
        seq: 2,
        producerId: "mixed",
        name: "message_update",
        correlation: { sessionId: "s", model: "kept" },
        payload: { cwd: "/kept" },
      },
    ]);
    now.mockReturnValue(start + 14 * day);
    expect(store.sessions().sessions.find((item) => item.producerId === "mixed")?.eventCount).toBe(2);
    expect(store.prune()).toBeGreaterThan(0);
    expect(store.sessions().sessions.find((item) => item.producerId === "mixed")).toMatchObject({
      eventCount: 1,
      cwd: "/kept",
      model: "kept",
      toolCount: 0,
      lastActivity: "message_update",
      lastLifecycle: null,
    });
    store.close();
  });
  it("builds summaries once for a pre-existing event table and then polls without bodies", () => {
    const dir = mkdtempSync(join(tmpdir(), "kite-store-"));
    directories.push(dir);
    const path = join(dir, "events.sqlite");
    const legacy = new DatabaseSync(path);
    legacy.exec(`CREATE TABLE events (
      cursor INTEGER PRIMARY KEY AUTOINCREMENT, producer TEXT NOT NULL,
      seq INTEGER NOT NULL, source TEXT NOT NULL, session TEXT,
      received INTEGER NOT NULL, body TEXT NOT NULL, UNIQUE(producer, seq))`);
    legacy
      .prepare("INSERT INTO events(producer,seq,source,session,received,body) VALUES(?,?,?,?,?,?)")
      .run(
        "producer",
        1,
        "future-source",
        "s",
        Date.now(),
        JSON.stringify({ ...event(), name: "agent_end" }),
      );
    legacy.close();
    let store = new EventStore(path);
    expect(store.sessions().sessions[0]).toMatchObject({
      lastEvent: "agent_end",
      lastLifecycle: "agent_end",
      eventCount: 1,
    });
    store.close();
    const raw = new DatabaseSync(path);
    raw.prepare("UPDATE events SET body='not-json'").run();
    raw.close();
    store = new EventStore(path);
    const broken = new DatabaseSync(join(dir, "broken.sqlite"));
    broken.exec(`CREATE TABLE events (
      cursor INTEGER PRIMARY KEY AUTOINCREMENT, producer TEXT NOT NULL,
      seq INTEGER NOT NULL, source TEXT NOT NULL, session TEXT,
      received INTEGER NOT NULL, body TEXT NOT NULL, UNIQUE(producer, seq))`);
    broken
      .prepare("INSERT INTO events(producer,seq,source,session,received,body) VALUES(?,?,?,?,?,?)")
      .run("producer", 1, "future-source", "s", Date.now(), "not-json");
    broken.close();
    expect(() => new EventStore(join(dir, "broken.sqlite"))).toThrow();
    const check = new DatabaseSync(join(dir, "broken.sqlite"));
    expect(check.prepare("SELECT body FROM events").get()?.body).toBe("not-json");
    expect(check.prepare("SELECT built FROM summary_meta WHERE id=1").get()).toBeUndefined();
    check.close();
    expect(store.sessions().sessions).toHaveLength(1);
    expect(store.sessions({ limit: 1 }).sessions[0]?.lastEvent).toBe("agent_end");
    store.close();
  });
});
