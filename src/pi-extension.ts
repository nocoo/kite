import { randomUUID } from "node:crypto";
import { eventPayload, snapshot } from "./capture.ts";
import { Exporter } from "./exporter.ts";
import { isRecord, type Json, type TraceEvent } from "./schema.ts";
import { socketPath } from "./transport.ts";

export const PI_EVENTS = [
  "project_trust",
  "resources_discover",
  "session_start",
  "session_info_changed",
  "session_before_switch",
  "session_before_fork",
  "session_before_compact",
  "session_compact",
  "session_compact_failed",
  "session_shutdown",
  "session_before_tree",
  "session_tree",
  "input",
  "user_bash",
  "before_agent_start",
  "agent_start",
  "agent_end",
  "agent_before_settle",
  "agent_settled",
  "turn_start",
  "turn_end",
  "message_start",
  "message_update",
  "message_end",
  "context",
  "context_with_system",
  "before_provider_request",
  "before_provider_headers",
  "after_provider_response",
  "cache_warming_decision",
  "tool_execution_start",
  "tool_execution_update",
  "tool_execution_end",
  "tool_call",
  "tool_result",
  "model_select",
  "thinking_level_select",
  "ui_prompt_start",
  "ui_prompt_end",
] as const;

interface PiContext {
  cwd?: string;
  model?: { id: string; provider: string };
  sessionManager?: {
    getSessionId(): string;
    getLeafId(): string | null;
    getSessionFile(): string | undefined;
  };
}
interface ObserverHost {
  on(
    name: (typeof PI_EVENTS)[number],
    handler: (event: Record<string, unknown>, context: PiContext) => unknown,
  ): unknown;
}

export function attach(pi: ObserverHost, makeExporter = () => new Exporter(socketPath())): void {
  const producerId = randomUUID();
  const origin = performance.now();
  let sequence = 0,
    run = 0,
    message = 0,
    reportedLoss = 0;
  let correlation: Record<string, string | number> = {};
  let exporter = makeExporter();
  let started = false;

  function emit(name: string, payload: Json, extra: Record<string, string | number> = {}): void {
    const event: TraceEvent = {
      schemaVersion: 1,
      source: "pi",
      producerId,
      seq: ++sequence,
      name,
      timestamp: Date.now(),
      monotonicMs: performance.now() - origin,
      correlation: { ...correlation, ...extra },
      payload,
    };
    exporter.enqueue(event);
  }

  for (const name of PI_EVENTS) {
    pi.on(name, (event, context) => {
      try {
        if (name === "session_start") {
          if (started) exporter = makeExporter();
          started = true;
          reportedLoss = 0;
          correlation = {};
          if (context.sessionManager) correlation.sessionId = context.sessionManager.getSessionId();
          exporter.start();
        }
        if (context.model) {
          correlation.model = context.model.id;
          correlation.provider = context.model.provider;
        }
        if (name === "agent_start") {
          correlation.runId = `${producerId}:${++run}`;
          delete correlation.turnIndex;
          delete correlation.messageId;
        }
        if (name === "turn_start" && typeof event.turnIndex === "number")
          correlation.turnIndex = event.turnIndex;
        if (name === "message_start") correlation.messageId = `${producerId}:m${++message}`;
        const extra: Record<string, string | number> = {};
        if (typeof event.toolCallId === "string") extra.toolCallId = event.toolCallId;
        if (isRecord(event.message) && typeof event.message.toolCallId === "string")
          extra.toolCallId = event.message.toolCallId;
        if (typeof event.toolName === "string") extra.toolName = event.toolName;
        if (
          isRecord(event.assistantMessageEvent) &&
          typeof event.assistantMessageEvent.contentIndex === "number"
        ) {
          extra.contentIndex = event.assistantMessageEvent.contentIndex;
        }
        if (exporter.dropped > reportedLoss) {
          const dropped = exporter.dropped;
          emit("kite.delivery_loss", { dropped: dropped - reportedLoss, total: dropped });
          reportedLoss = dropped;
        }
        let payload = eventPayload(event);
        if (isRecord(payload) && typeof payload.toolCallId === "string")
          extra.toolCallId = payload.toolCallId;
        if (name === "session_start")
          payload = snapshot({
            event,
            cwd: context.cwd,
            sessionFile: context.sessionManager?.getSessionFile(),
            leafId: context.sessionManager?.getLeafId(),
            integration: { testedPiVersion: "0.87.1", schemaVersion: 1, hooks: PI_EVENTS },
          });
        emit(name, payload, extra);
        if (name === "message_end") delete correlation.messageId;
        if (name === "agent_settled") {
          delete correlation.runId;
          delete correlation.turnIndex;
        }
      } catch {
        /* Capture must never influence Pi's control hooks. */
      }
      if (name === "session_shutdown") {
        try {
          return exporter.close().then(
            () => undefined,
            () => undefined,
          );
        } catch {
          return undefined;
        }
      }
      if (name === "project_trust") return { trusted: "undecided" };
      return undefined;
    });
  }
}

export default function extension(pi: ObserverHost): void {
  attach(pi);
}
