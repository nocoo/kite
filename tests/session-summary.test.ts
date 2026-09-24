import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { applyRecording, RECORDINGS_DDL, sessionsSql } from "../src/session-summary.ts";
import { event } from "./fixtures.ts";

describe("recording summary fold", () => {
  it("keeps the latest scalar, ignores a repeated cursor, and counts only real errors", () => {
    const first = applyRecording(
      undefined,
      { ...event(), name: "agent_start", payload: { cwd: 1 }, correlation: { sessionId: "s", model: 2 } },
      4,
      10,
    );
    const folded = applyRecording(
      first,
      {
        ...event(),
        name: "tool_execution_end",
        payload: { isError: false, cwd: "/work" },
        correlation: { sessionId: "s", provider: "pi" },
      },
      5,
      8,
    );
    const errored = applyRecording(
      folded,
      { ...event(), name: "tool_execution_end", payload: { isError: true } },
      6,
      12,
    );
    const lost = applyRecording(errored, { ...event(), name: "kite.delivery_loss", payload: ["no"] }, 7, 13);
    expect(lost).toMatchObject({
      cwd: "/work",
      model: null,
      provider: "pi",
      lastEvent: "kite.delivery_loss",
      lastLifecycle: "agent_start",
      lastActivity: "tool_execution_end",
      toolCount: 0,
      errorCount: 1,
      lossCount: 1,
      eventCount: 4,
      firstSeen: 8,
      lastSeen: 13,
    });
    expect(applyRecording(lost, event(), 7, 99)).toBe(lost);
    const started = applyRecording(
      undefined,
      { ...event(), name: "tool_execution_start", payload: null },
      1,
      1,
    );
    expect(started.toolCount).toBe(1);
    expect(started.cwd).toBeNull();
  });

  it("polls recordings by cursor index without reading event bodies", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(RECORDINGS_DDL);
    db.exec("CREATE TABLE events (body TEXT)");
    for (const bounded of [false, true]) {
      const plan = JSON.stringify(db.prepare(`EXPLAIN QUERY PLAN ${sessionsSql(bounded)}`).all());
      expect(plan).toContain("recordings");
      expect(plan).not.toContain("events");
      expect(plan.toLowerCase()).not.toContain("json");
    }
    db.close();
  });
});
