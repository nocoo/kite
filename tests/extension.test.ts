import { afterEach, describe, expect, it, vi } from "vitest";
import { Exporter } from "../src/exporter.ts";
import extension, { attach, PI_EVENTS } from "../src/pi-extension.ts";

type Host = Parameters<typeof attach>[0];
type Handler = Parameters<Host["on"]>[1];
const context = {
  cwd: "/project",
  model: { id: "model", provider: "provider" },
  sessionManager: {
    getSessionId: () => "session",
    getLeafId: () => "leaf",
    getSessionFile: () => "/session",
  },
};
afterEach(() => vi.restoreAllMocks());

function observer(maxCount = 2048) {
  const handlers = new Map<string, Handler>();
  const exporters: Exporter[] = [];
  const factory = () => {
    const exporter = new Exporter("unused", maxCount, 8000000, async (body) => ({
      status: 200,
      body: { accepted: JSON.parse(body).length },
    }));
    vi.spyOn(exporter, "start").mockImplementation(() => {});
    vi.spyOn(exporter, "enqueue");
    exporters.push(exporter);
    return exporter;
  };
  attach({ on: (name, handler) => handlers.set(name, handler) }, factory);
  const fire = (name: string, extra: Record<string, unknown> = {}, ctx = context) =>
    handlers.get(name)?.({ type: name, ...extra }, ctx);
  const trace = () => exporters.flatMap((e) => vi.mocked(e.enqueue).mock.calls.map((call) => call[0]));
  return { handlers, fire, trace, exporters };
}

describe("passive released Pi integration", () => {
  it("registers all 39 released hooks and preserves every control return contract", async () => {
    const o = observer();
    expect(o.handlers.size).toBe(39);
    expect(o.handlers.has("provider_stream_event")).toBe(false);
    expect(o.exporters[0]?.start).not.toHaveBeenCalled();
    for (const name of PI_EVENTS) {
      const input = Object.freeze({ type: name, nested: Object.freeze({ value: true }) });
      const result = await o.handlers.get(name)?.(input, context);
      expect(result).toEqual(name === "project_trust" ? { trusted: "undecided" } : undefined);
      expect(input.nested.value).toBe(true);
    }
    expect(o.trace().map((e) => e.name)).toContain("session_shutdown");
    await Promise.all(o.exporters.map((e) => e.close()));
  });
  it("buffers trust before a session and assigns unique monotonic identities", async () => {
    const o = observer();
    o.fire("project_trust", {}, {} as typeof context);
    expect(o.trace()[0]?.correlation).toEqual({});
    o.fire("session_start");
    o.fire("agent_start");
    o.fire("turn_start", { turnIndex: 0 });
    o.fire("message_start", { message: { role: "assistant" } });
    o.fire("message_update", {
      message: { content: "cumulative" },
      assistantMessageEvent: {
        contentIndex: 2,
        delta: "a",
        partial: { content: [null, null, { type: "toolCall", id: "t", name: "read" }] },
      },
    });
    o.fire("message_end", { message: { role: "assistant", text: "final" } });
    o.fire("tool_execution_start", { toolCallId: "t", toolName: "read" });
    o.fire("agent_end");
    o.fire("agent_start");
    o.fire("turn_start", { turnIndex: 0 });
    o.fire("agent_settled");
    o.fire("input");
    const trace = o.trace();
    expect(new Set(trace.map((e) => e.seq)).size).toBe(trace.length);
    expect(trace.every((e, i) => i === 0 || e.monotonicMs >= (trace[i - 1]?.monotonicMs ?? 0))).toBe(true);
    const messages = trace.filter((e) => e.name.startsWith("message_"));
    expect(new Set(messages.map((e) => e.correlation?.messageId)).size).toBe(1);
    expect(messages[1]?.correlation?.contentIndex).toBe(2);
    expect(messages[1]?.correlation?.toolCallId).toBe("t");
    expect(trace.find((e) => e.name === "tool_execution_start")?.correlation).toMatchObject({
      toolCallId: "t",
      toolName: "read",
    });
    expect(new Set(trace.filter((e) => e.name === "agent_start").map((e) => e.correlation?.runId)).size).toBe(
      2,
    );
    expect(trace.at(-1)?.correlation).not.toHaveProperty("runId");
    await o.fire("session_shutdown");
    o.fire("session_start");
    expect(o.exporters).toHaveLength(2);
    await o.fire("session_shutdown");
    const other = observer();
    other.fire("input");
    expect(other.trace()[0]?.producerId).not.toBe(trace[0]?.producerId);
    await other.exporters[0]?.close();
  });
  it("correlates tool-result messages and reports bounded queue loss", async () => {
    const o = observer(2);
    o.fire("session_start");
    o.fire("message_start", { message: { toolCallId: "t" } });
    o.fire("message_update");
    o.fire("message_end");
    expect(o.trace().some((e) => e.name === "kite.delivery_loss")).toBe(true);
    expect(o.trace().find((e) => e.name === "message_start")?.correlation?.toolCallId).toBe("t");
    await o.fire("session_shutdown");
  });
  it("contains all capture errors, including trust and tool interception, and always closes", async () => {
    const o = observer();
    const first = o.exporters[0];
    if (!first) throw new Error("missing exporter");
    vi.mocked(first.enqueue).mockImplementation(() => {
      throw new Error("capture failure");
    });
    for (const name of ["tool_call", "user_bash", "input", "before_provider_request"])
      expect(o.fire(name)).toBeUndefined();
    expect(o.fire("project_trust")).toEqual({ trusted: "undecided" });
    const bad = {
      get model(): typeof context.model {
        throw new Error("bad context");
      },
    };
    const close = vi.spyOn(first, "close").mockRejectedValueOnce(new Error("flush failed"));
    expect(await o.handlers.get("session_shutdown")?.({ type: "session_shutdown" }, bad)).toBeUndefined();
    expect(close).toHaveBeenCalled();
    close.mockImplementationOnce(() => {
      throw new Error("sync failure");
    });
    expect(o.fire("session_shutdown")).toBeUndefined();
  });
  it("loads the default entry without timers, sockets or unsupported host calls", () => {
    const handlers = new Map<string, Handler>();
    extension({ on: (name, handler) => handlers.set(name, handler) });
    expect(handlers.size).toBe(39);
    expect(handlers.get("project_trust")?.({ type: "project_trust" }, {})).toEqual({ trusted: "undecided" });
  });
});
