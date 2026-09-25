import { describe, expect, it } from "vitest";
import type { StoredEvent } from "../src/store.ts";
import {
  applyEvent,
  directoryName,
  duration,
  emptyProjection,
  eventCatalog,
  eventInfo,
  filteredEvents,
  filteredSessions,
  fleetSummary,
  type ModuleId,
  modules,
  observedSignals,
  project,
  record,
  replayIndex,
  replayTimes,
  sessionKey,
  sessionStatus,
  stableSessions,
  type ToolAttempt,
  textValue,
  toolWindow,
} from "../web/model.ts";

const hookModule: Record<string, ModuleId> = {
  project_trust: "session",
  resources_discover: "session",
  session_start: "session",
  session_info_changed: "session",
  session_before_switch: "session",
  session_before_fork: "session",
  session_before_tree: "session",
  session_tree: "session",
  session_shutdown: "session",
  model_select: "session",
  thinking_level_select: "session",
  input: "input",
  user_bash: "input",
  before_agent_start: "input",
  agent_start: "input",
  ui_prompt_start: "input",
  ui_prompt_end: "input",
  turn_start: "context",
  context: "context",
  context_with_system: "context",
  before_provider_request: "provider",
  before_provider_headers: "provider",
  after_provider_response: "provider",
  cache_warming_decision: "provider",
  message_start: "response",
  message_update: "response",
  message_end: "response",
  tool_execution_start: "tools",
  tool_call: "tools",
  tool_execution_update: "tools",
  tool_result: "tools",
  tool_execution_end: "tools",
  turn_end: "settle",
  agent_end: "settle",
  agent_before_settle: "settle",
  agent_settled: "settle",
  session_before_compact: "compaction",
  session_compact: "compaction",
  session_compact_failed: "compaction",
};

const stored = (name: string, patch: Partial<StoredEvent> = {}): StoredEvent => ({
  schemaVersion: 1,
  source: "pi",
  name,
  producerId: "producer-a",
  seq: 1,
  timestamp: 1_700_000_000_000,
  monotonicMs: 1_000,
  cursor: 1,
  receivedAt: 1_700_000_000_100,
  payload: {},
  ...patch,
});

const session = (patch: Record<string, unknown> = {}) =>
  ({
    source: "pi",
    sessionId: "session-1",
    producerId: "producer-a",
    lastLifecycle: "session_start",
    lastActivity: "session_start",
    lastSeen: 10_000,
    cwd: "/work/kite",
    ...patch,
  }) as Parameters<typeof sessionStatus>[0];

describe("catalog and identity helpers", () => {
  it("classifies the 39 Pi hooks and preserves an unknown name", () => {
    expect(Object.keys(hookModule)).toHaveLength(39);
    expect(Object.keys(eventCatalog).sort()).toEqual(
      [...Object.keys(hookModule), "kite.delivery_loss"].sort(),
    );
    for (const [name, module] of Object.entries(hookModule)) {
      const info = eventInfo(stored(name));
      expect(info.module).toBe(module);
      expect(info.label).toBe(eventCatalog[name]?.label);
      expect(modules.some((item) => item.id === module)).toBe(true);
    }
    expect(eventInfo(stored("kite.delivery_loss")).module).toBe("session");
    const unknown = eventInfo(stored("future_hook", { payload: { kept: true } }));
    expect(unknown).toEqual({
      module: "session",
      label: "future_hook",
      description: "An unclassified observation is preserved as received.",
    });
    expect(eventCatalog.future_hook).toBeUndefined();
    expect(eventInfo(stored("constructor")).module).toBe("session");
    expect(eventInfo(stored("toString")).label).toBe("toString");
    expect(eventInfo(stored("message_update", { payload: null })).label).toBe("Response chunk");
    expect(
      eventInfo(stored("message_update", { payload: { assistantMessageEvent: { type: 3 } } })).label,
    ).toBe("Response chunk");
    expect(
      eventInfo(stored("message_update", { payload: { assistantMessageEvent: { type: "thinking_delta" } } }))
        .label,
    ).toBe("thinking delta");
  });

  it("keys a session by source, id and producer, and names the directory", () => {
    expect(sessionKey(session())).toBe(JSON.stringify(["pi", "session-1", "producer-a"]));
    expect(sessionKey(session({ source: "a,b", sessionId: "c", producerId: "d" }))).not.toBe(
      sessionKey(session({ source: "a", sessionId: "b,c", producerId: "d" })),
    );
    expect(directoryName("/work/kite")).toBe("kite");
    expect(directoryName("kite")).toBe("kite");
    expect(directoryName("/work/kite/")).toBe("kite");
    expect(directoryName(null)).toBe("Unknown directory");
    expect(directoryName("")).toBe("Unknown directory");
    expect(directoryName("/")).toBe("Unknown directory");
  });

  it("treats a quiet session as quiet, and a shutdown as closed", () => {
    const now = 50_000;
    expect(sessionStatus(session({ lastLifecycle: "session_shutdown", lastSeen: 0 }), now)).toBe("Closed");
    expect(sessionStatus(session({ lastLifecycle: "agent_settled", lastSeen: 0 }), now)).toBe("Settled");
    expect(sessionStatus(session({ lastLifecycle: "agent_end", lastSeen: now - 30_001 }), now)).toBe("Quiet");
    expect(sessionStatus(session({ lastLifecycle: "agent_start", lastSeen: now - 30_000 }), now)).toBe(
      "Running",
    );
    expect(
      sessionStatus(
        session({ lastLifecycle: "agent_end", lastActivity: "ui_prompt_start", lastSeen: now }),
        now,
      ),
    ).toBe("Awaiting input");
    expect(sessionStatus(session({ lastLifecycle: "agent_end", lastSeen: now }), now)).toBe("Between runs");
    expect(sessionStatus(session({ lastLifecycle: "agent_start", lastSeen: now }), now)).toBe("Running");
    expect(sessionStatus(session({ lastLifecycle: "turn_end", lastSeen: now }), now)).toBe("Observing");
  });

  it("formats duration boundaries without treating sub-second values as seconds", () => {
    expect(duration(-4)).toBe("0ms");
    expect(duration(0)).toBe("0ms");
    expect(duration(999.4)).toBe("999ms");
    expect(duration(999.6)).toBe("1000ms");
    expect(duration(1000)).toBe("1.0s");
    expect(duration(1500)).toBe("1.5s");
    expect(duration(59_999)).toBe("60.0s");
    expect(duration(60_000)).toBe("1m 0s");
    expect(duration(90_000)).toBe("1m 30s");
    expect(duration(3_599_999)).toBe("59m 59s");
    expect(duration(3_600_000)).toBe("1h 0m");
    expect(duration(3_661_000)).toBe("1h 1m");
    expect(record(null)).toEqual({});
    expect(record([])).toEqual({});
    expect(record({ ok: 1 })).toEqual({ ok: 1 });
    expect(textValue(1)).toBe("");
    expect(textValue("kept")).toBe("kept");
  });
});

describe("projection lifecycle", () => {
  it("counts runs, keeps turn totals, and separates agent_end from agent_settled", () => {
    const events = [
      stored("session_start", { seq: 1 }),
      stored("agent_start", { seq: 2, monotonicMs: 1100 }),
      stored("turn_start", { seq: 3, monotonicMs: 1200 }),
      stored("turn_end", { seq: 4, monotonicMs: 1300 }),
      stored("agent_end", { seq: 5, monotonicMs: 1400 }),
      stored("ui_prompt_start", { seq: 6, monotonicMs: 1500 }),
      stored("ui_prompt_end", { seq: 7, monotonicMs: 1600 }),
      stored("agent_start", { seq: 8, monotonicMs: 1700 }),
      stored("turn_start", { seq: 9, monotonicMs: 1800 }),
      stored("agent_settled", { seq: 10, monotonicMs: 1900 }),
      stored("session_before_compact", { seq: 11, monotonicMs: 2000 }),
      stored("session_compact_failed", { seq: 12, monotonicMs: 2100 }),
      stored("session_before_compact", { seq: 13, monotonicMs: 2200 }),
      stored("session_compact", { seq: 14, monotonicMs: 2300 }),
      stored("session_shutdown", { seq: 15, monotonicMs: 2400 }),
    ];
    const ended = project(events, 4);
    expect(ended.runs).toBe(1);
    expect(ended.turns).toBe(1);
    expect(ended.status).toBe("Between runs");
    expect(ended.active).toBe("settle");
    const restarted = project(events, 8);
    expect(restarted.runs).toBe(2);
    expect(restarted.turns).toBe(2);
    expect(restarted.status).toBe("Running");
    expect(project(events, 5).status).toBe("Awaiting input");
    expect(project(events, 6).status).toBe("Observing");
    const settled = project(events, 9);
    expect(settled.status).toBe("Settled");
    expect(settled.active).toBeNull();
    expect(settled.hits.settle).toBe(3);
    expect(project(events, 10).status).toBe("Compacting");
    expect(project(events, 11).status).toBe("Compaction failed");
    expect(project(events, 13).status).toBe("Observing");
    const closed = project(events);
    expect(closed.status).toBe("Closed");
    expect(closed.active).toBeNull();
    expect(closed.hits.session).toBe(2);
    expect(closed.hits.compaction).toBe(4);
    expect(project([])).toEqual(emptyProjection());
    expect(project(events, -1).runs).toBe(0);
    expect(project(events, 99).status).toBe("Closed");
    const fresh = emptyProjection();
    applyEvent(fresh, events[1] as StoredEvent);
    expect(emptyProjection().runs).toBe(0);
  });

  it("keeps truncated final content visible and leaves missing tool duration unknown", () => {
    const projection = project([
      stored("message_update", {
        payload: { assistantMessageEvent: { type: "text_delta", delta: "streamed" } },
      }),
      stored("message_end", {
        seq: 2,
        payload: {
          message: {
            role: "assistant",
            content: [
              { type: "text", text: { text: "captured prefix", _kiteTruncated: true } },
              { type: "thinking", thinking: { text: "exposed prefix", _kiteTruncated: true } },
            ],
          },
        },
      }),
      stored("tool_execution_end", {
        seq: 3,
        correlation: { toolCallId: "partial" },
        monotonicMs: 2000,
        payload: { isError: true },
      }),
    ]);
    expect(projection.text).toBe("captured prefix\n[Capture truncated]");
    expect(projection.thinking).toBe("exposed prefix\n[Capture truncated]");
    expect(projection.tools[0]).toMatchObject({ start: undefined, end: 2000, status: "error" });
  });
  it("tracks parallel tools that finish out of order, including partial and missing ids", () => {
    const run = { runId: "run-1" };
    const events = [
      stored("tool_execution_start", {
        seq: 1,
        monotonicMs: 10,
        correlation: { ...run, toolCallId: "a", toolName: "read" },
        payload: { toolCallId: "ignored", toolName: "ignored" },
      }),
      stored("tool_execution_start", {
        seq: 2,
        monotonicMs: 20,
        correlation: { ...run, toolCallId: "b", toolName: "write" },
      }),
      stored("tool_call", {
        seq: 3,
        monotonicMs: 30,
        correlation: { ...run, toolCallId: "b" },
        payload: { blocked: true },
      }),
      stored("tool_execution_update", {
        seq: 4,
        monotonicMs: 40,
        correlation: { ...run, toolCallId: "a" },
      }),
      stored("tool_result", {
        seq: 5,
        monotonicMs: 50,
        correlation: { ...run, toolCallId: "b" },
        payload: { isError: true, message: "validation failed" },
      }),
      stored("tool_execution_end", {
        seq: 6,
        monotonicMs: 60,
        correlation: { ...run, toolCallId: "b" },
        payload: { isError: true },
      }),
      stored("tool_execution_end", {
        seq: 7,
        monotonicMs: 70,
        correlation: { ...run, toolCallId: "a" },
        payload: { isError: false },
      }),
      stored("tool_result", {
        seq: 8,
        monotonicMs: 80,
        payload: { toolCallId: "orphan", toolName: "bash", output: "only result" },
      }),
      stored("tool_execution_end", {
        seq: 9,
        monotonicMs: 90,
        payload: { toolName: "no-id", isError: true },
      }),
      stored("tool_call", {
        seq: 10,
        monotonicMs: 100,
        correlation: { toolCallId: "" },
        payload: { toolCallId: "from-payload", toolName: "grep" },
      }),
      stored("tool_execution_start", {
        seq: 11,
        monotonicMs: 110,
        correlation: { runId: "run-2", toolCallId: "a", toolName: "read" },
      }),
    ];
    const view = project(events);
    const byId = Object.fromEntries(view.tools.map((tool) => [tool.id, tool]));
    expect(byId["run-1:b"]?.status).toBe("error");
    expect(byId["run-1:b"]?.end).toBe(60);
    expect(byId["run-1:b"]?.start).toBe(20);
    expect(byId["run-1:a"]?.status).toBe("completed");
    expect(byId["run-1:a"]?.end).toBe(70);
    expect(byId["run-1:a"]?.name).toBe("read");
    expect(byId[":orphan"]).toMatchObject({ status: "result", name: "bash", start: undefined });
    expect(byId[":orphan"]?.end).toBeUndefined();
    expect(byId[":from-payload"]).toMatchObject({ status: "checked", name: "grep" });
    expect(byId["run-2:a"]?.status).toBe("attempt");
    expect(view.tools.some((tool) => tool.name === "no-id")).toBe(false);
    expect(byId["run-1:b"]?.detail).toBe(JSON.stringify({ isError: true }));
    const wide = "x".repeat(5000);
    const state = emptyProjection();
    applyEvent(
      state,
      stored("tool_result", {
        correlation: { toolCallId: "wide" },
        payload: { blob: wide },
      }),
    );
    expect(state.tools[0]?.detail.length).toBe(4096);
  });

  it("accumulates exposed chunks, then uses each final assistant message once", () => {
    const chunk = (seq: number, type: string, delta: string) =>
      stored("message_update", {
        seq,
        payload: { assistantMessageEvent: { type, delta } },
      });
    const events = [
      stored("message_start", { seq: 1, payload: { message: { role: "user", content: "hi" } } }),
      chunk(2, "thinking_delta", "plan "),
      chunk(3, "text_delta", "Hello "),
      chunk(4, "text_delta", "world"),
      chunk(5, "other", "ignore"),
      stored("message_end", {
        seq: 6,
        payload: {
          message: {
            role: "assistant",
            content: [
              { type: "thinking", thinking: "final plan" },
              null,
              { type: "text", text: "Final answer" },
              { type: "text", text: 12 },
              { type: "image" },
            ],
            usage: { totalTokens: 11 },
          },
        },
      }),
      stored("message_update", {
        seq: 7,
        payload: {
          assistantMessageEvent: { type: "text_delta", delta: "late" },
          message: { usage: { totalTokens: 99 } },
        },
      }),
      stored("message_start", { seq: 8, payload: { message: { role: "assistant" } } }),
      chunk(9, "text_delta", "next"),
      stored("message_end", {
        seq: 10,
        payload: { message: { role: "assistant", content: "not-array", usage: { totalTokens: "4" } } },
      }),
      stored("message_end", {
        seq: 11,
        payload: { message: { role: "tool", usage: { totalTokens: 50 } } },
      }),
    ];
    const streamed = project(events, 4);
    expect(streamed.chunks).toBe(4);
    expect(streamed.thinking).toBe("plan ");
    expect(streamed.text).toBe("Hello world");
    expect(streamed.tokens).toBe(0);
    const userStart = project(events, 0);
    userStart.text = "keep";
    expect(project(events, 0).text).toBe("");
    const final = project(events, 5);
    expect(final.text).toBe("Final answer");
    expect(final.thinking).toBe("final plan");
    expect(final.tokens).toBe(11);
    const afterLate = project(events, 6);
    expect(afterLate.text).toBe("Final answerlate");
    expect(afterLate.tokens).toBe(11);
    const reset = project(events, 7);
    expect(reset.text).toBe("");
    expect(reset.thinking).toBe("");
    const second = project(events, 9);
    expect(second.text).toBe("");
    expect(second.thinking).toBe("");
    expect(second.tokens).toBe(11);
    expect(project(events).tokens).toBe(11);
    const bounded = emptyProjection();
    applyEvent(
      bounded,
      stored("message_update", {
        payload: { assistantMessageEvent: { type: "text_delta", delta: "y".repeat(32_769) } },
      }),
    );
    applyEvent(
      bounded,
      stored("message_update", {
        payload: { assistantMessageEvent: { type: "thinking_delta", delta: "z".repeat(32_769) } },
      }),
    );
    expect(bounded.text).toHaveLength(32_768);
    expect(bounded.thinking).toHaveLength(32_768);
    applyEvent(
      bounded,
      stored("message_end", {
        payload: {
          message: {
            role: "assistant",
            content: [
              { type: "text", text: "q".repeat(32_769) },
              { type: "thinking", thinking: "r".repeat(32_769) },
            ],
            usage: { totalTokens: 2 },
          },
        },
      }),
    );
    expect(bounded.text).toHaveLength(32_768);
    expect(bounded.thinking).toHaveLength(32_768);
    expect(bounded.tokens).toBe(2);
  });

  it("counts same-producer gaps and numeric delivery loss only", () => {
    const events = [
      stored("input", { seq: 5, producerId: "a" }),
      stored("input", { seq: 8, producerId: "a" }),
      stored("input", { seq: 1, producerId: "b" }),
      stored("input", { seq: 3, producerId: "a" }),
      stored("input", { seq: 3, producerId: "a" }),
      stored("kite.delivery_loss", { seq: 4, producerId: "a", payload: { dropped: 2 } }),
      stored("kite.delivery_loss", { seq: 5, producerId: "a", payload: { dropped: "3" } }),
      stored("kite.delivery_loss", { seq: 6, producerId: "a", payload: null }),
      stored("kite.delivery_loss", { seq: 9, producerId: "a", payload: { dropped: 1 } }),
    ];
    const view = project(events);
    expect(view.gaps).toBe(2 + 0 + 2);
    expect(view.loss).toBe(3);
    expect(view.lastProducer).toBe("a");
    expect(view.lastSeq).toBe(9);
    expect(view.hits.session).toBe(4);
    expect(view.hits.input).toBe(5);
  });
});

describe("replay and filters", () => {
  it("binary-searches monotonic replay times, including out-of-order clocks", () => {
    expect(replayTimes([])).toEqual([]);
    expect(replayIndex([], 5)).toBe(0);
    const events = [
      stored("input", { seq: 1, monotonicMs: 100 }),
      stored("input", { seq: 2, monotonicMs: 50 }),
      stored("input", { seq: 3, monotonicMs: 180 }),
      stored("input", { seq: 4, monotonicMs: 130 }),
      stored("input", { seq: 5, monotonicMs: 180 }),
    ];
    const times = replayTimes(events);
    expect(times).toEqual([0, 0, 80, 80, 80]);
    expect(replayIndex(times, -1)).toBe(0);
    expect(replayIndex(times, 0)).toBe(1);
    expect(replayIndex(times, 79)).toBe(1);
    expect(replayIndex(times, 80)).toBe(4);
    expect(replayIndex(times, 500)).toBe(4);
    const spaced = [0, 10, 20, 30, 40];
    expect(replayIndex(spaced, 0)).toBe(0);
    expect(replayIndex(spaced, 20)).toBe(2);
    expect(replayIndex(spaced, 25)).toBe(2);
    expect(replayIndex(spaced, 40)).toBe(4);
    expect(replayIndex([0, 5, 5, 5, 9], 5)).toBe(3);
  });

  it("filters by module and by name or payload text", () => {
    const events = [
      stored("agent_start", { seq: 1, payload: { prompt: "Ship it" } }),
      stored("tool_result", { seq: 2, payload: { toolName: "read", path: "web/model.ts" } }),
      stored("message_update", {
        seq: 3,
        payload: { assistantMessageEvent: { type: "text_delta", delta: "thinking delta" } },
      }),
    ];
    expect(filteredEvents(events, "all", "  ")).toEqual(events);
    expect(filteredEvents(events, "tools", "").map((event) => event.name)).toEqual(["tool_result"]);
    expect(filteredEvents(events, "all", "  AGENT_START ").map((event) => event.seq)).toEqual([1]);
    expect(filteredEvents(events, "input", "model.ts")).toEqual([]);
    expect(filteredEvents(events, "all", "web/model.ts").map((event) => event.seq)).toEqual([2]);
    expect(filteredEvents(events, "response", "text delta")).toEqual([]);
    expect(filteredEvents(events, "response", "text_delta").map((event) => event.seq)).toEqual([3]);
  });
});

describe("execution bridge projections", () => {
  it("keeps session positions across updates and appends new recordings", () => {
    const a = session({ producerId: "a", lastCursor: 10 });
    const b = session({ producerId: "b", lastCursor: 20 });
    const newerA = { ...a, lastCursor: 100 };
    const c = session({ producerId: "c", lastCursor: 90 });
    const d = session({ producerId: "d", lastCursor: 120 });
    expect(stableSessions([], [a, b])).toEqual([b, a]);
    expect(stableSessions([b, a], [c, newerA, d, b])).toEqual([b, newerA, d, c]);
    expect(stableSessions([b, a], [newerA])).toEqual([newerA]);
    expect(stableSessions([a], [])).toEqual([]);
    expect(a.lastCursor).toBe(10);
  });

  it("summarizes actual latest phases without treating old activity as live", () => {
    const base = { eventCount: 10, toolCount: 2, errorCount: 1 };
    const result = fleetSummary(
      [
        session({ ...base, lastLifecycle: "agent_start", lastActivity: "tool_call", lastSeen: 50_000 }),
        session({ ...base, lastActivity: null, lastEvent: "session_shutdown", lastSeen: 0 }),
        session({ ...base, lastLifecycle: "agent_start", lastActivity: "context", lastSeen: 0 }),
      ],
      50_000,
    );
    expect(result).toMatchObject({ running: 1, observations: 30, tools: 6, errors: 3 });
    expect(result.phases).toMatchObject({ tools: 1, session: 1, context: 1, provider: 0 });
    expect(fleetSummary([], 0).observations).toBe(0);
    expect(fleetSummary([session({ lastSeen: 50_000, lastEvent: "tool_result" })], 50_000).signals).toEqual([
      "tools",
    ]);
    expect(fleetSummary([session({ lastSeen: 50_000, lastEvent: "tool_result" })], 1).signals).toEqual([]);
  });

  it("exposes latest module evidence and only the tool stages actually observed", () => {
    const trace = [
      stored("tool_call", { seq: 1, cursor: 1, correlation: { toolCallId: "a" } }),
      stored("tool_execution_update", { seq: 2, cursor: 2, correlation: { toolCallId: "a" } }),
      stored("tool_execution_update", { seq: 3, cursor: 3, correlation: { toolCallId: "a" } }),
      stored("context", { seq: 4, cursor: 4 }),
    ];
    const projection = project(trace);
    expect(projection.latest.tools).toBe(trace[2]);
    expect(projection.latest.context).toBe(trace[3]);
    expect(projection.latest.provider).toBeUndefined();
    expect(projection.tools[0]?.hooks).toEqual(["tool_call", "tool_execution_update"]);
    expect(project(trace, 0).tools[0]?.hooks).toEqual(["tool_call"]);
    const tools = Array.from({ length: 7 }, (_, i) => ({
      ...(projection.tools[0] as ToolAttempt),
      id: String(i),
    }));
    expect(toolWindow(tools, null)).toEqual({ tools: tools.slice(4), page: 2, pages: 3 });
    expect(toolWindow(tools, 0).tools).toEqual(tools.slice(0, 3));
    expect(toolWindow(tools, 1).tools).toEqual(tools.slice(3, 6));
    expect(toolWindow(tools, 99).page).toBe(2);
    expect(toolWindow(tools, -2).page).toBe(0);
    expect(toolWindow([], null)).toEqual({ tools: [], page: 0, pages: 1 });
  });
});

it("lights only recently observed modules in the chosen clock", () => {
  const view = project([
    stored("input", { timestamp: 5000, monotonicMs: 10 }),
    stored("tool_call", { timestamp: 6000, monotonicMs: 1000 }),
    stored("context", { timestamp: 9000, monotonicMs: 4000 }),
  ]);
  expect(observedSignals(view, 7500, "timestamp")).toEqual(["input", "tools"]);
  expect(observedSignals(view, 10_000, "timestamp")).toEqual(["context"]);
  expect(observedSignals(view, 14_000, "timestamp")).toEqual([]);
  expect(observedSignals(view, 4000, "monotonicMs")).toEqual(["context"]);
  expect(observedSignals(emptyProjection(), 0, "monotonicMs")).toEqual([]);
});

it("filters fleet identity and phase without changing its order", () => {
  const a = session({ producerId: "a", lastActivity: "tool_call" });
  const b = session({ producerId: "b", lastActivity: null, lastEvent: "context" });
  expect(filteredSessions([a, b], " KITE ", "all")).toEqual([a, b]);
  expect(filteredSessions([a, b], "", "tools")).toEqual([a]);
  expect(filteredSessions([a, b], "", "context")).toEqual([b]);
  expect(filteredSessions([a, b], "missing", "all")).toEqual([]);
});
