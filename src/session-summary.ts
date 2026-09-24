import type { TraceEvent } from "./schema.ts";
import { isRecord } from "./schema.ts";

export const LIFECYCLE = new Set([
  "session_start",
  "session_shutdown",
  "agent_start",
  "agent_end",
  "agent_settled",
]);
export const ACTIVITY = new Set([
  "input",
  "before_agent_start",
  "context",
  "context_with_system",
  "before_provider_request",
  "after_provider_response",
  "message_update",
  "tool_execution_start",
  "tool_execution_end",
  "ui_prompt_start",
  "ui_prompt_end",
  "session_before_compact",
  "session_compact",
  "session_compact_failed",
]);

export interface RecordingUpdate {
  source: string;
  sessionId: string;
  producerId: string;
  firstCursor: number;
  lastCursor: number;
  firstSeen: number;
  lastSeen: number;
  eventCount: number;
  cwd: string | null;
  model: string | null;
  provider: string | null;
  lastEvent: string;
  lastLifecycle: string | null;
  lastActivity: string | null;
  toolCount: number;
  errorCount: number;
  lossCount: number;
  cwdCursor: number;
  modelCursor: number;
  providerCursor: number;
  lifecycleCursor: number;
  activityCursor: number;
}

const text = (value: unknown) => (typeof value === "string" ? value : null);
const keep = (cursor: number, next: string | null, priorCursor: number, prior: string | null) =>
  next === null || cursor < priorCursor ? prior : next;
const keptCursor = (cursor: number, next: string | null, priorCursor: number) =>
  next === null || cursor < priorCursor ? priorCursor : cursor;

export function applyRecording(
  current: RecordingUpdate | undefined,
  event: Pick<TraceEvent, "name" | "source" | "producerId" | "correlation" | "payload">,
  cursor: number,
  receivedAt: number,
  sessionId = String(event.correlation?.sessionId ?? ""),
): RecordingUpdate {
  if (current && cursor <= current.lastCursor) return current;
  const payload = isRecord(event.payload) ? event.payload : {};
  const cwd = text(payload.cwd);
  const model = text(event.correlation?.model);
  const provider = text(event.correlation?.provider);
  const lifecycle = LIFECYCLE.has(event.name) ? event.name : null;
  const activity = ACTIVITY.has(event.name) ? event.name : null;
  const base = {
    cwd,
    model,
    provider,
    lastEvent: event.name,
    lastLifecycle: lifecycle,
    lastActivity: activity,
    toolCount: event.name === "tool_execution_start" ? 1 : 0,
    errorCount: event.name === "tool_execution_end" && payload.isError === true ? 1 : 0,
    lossCount: event.name === "kite.delivery_loss" ? 1 : 0,
    cwdCursor: cwd === null ? 0 : cursor,
    modelCursor: model === null ? 0 : cursor,
    providerCursor: provider === null ? 0 : cursor,
    lifecycleCursor: lifecycle === null ? 0 : cursor,
    activityCursor: activity === null ? 0 : cursor,
  };
  if (!current) {
    return {
      source: event.source,
      sessionId,
      producerId: event.producerId,
      firstCursor: cursor,
      lastCursor: cursor,
      firstSeen: receivedAt,
      lastSeen: receivedAt,
      eventCount: 1,
      ...base,
    };
  }
  return {
    ...current,
    firstCursor: Math.min(current.firstCursor, cursor),
    lastCursor: cursor,
    firstSeen: Math.min(current.firstSeen, receivedAt),
    lastSeen: Math.max(current.lastSeen, receivedAt),
    eventCount: current.eventCount + 1,
    cwd: keep(cursor, cwd, current.cwdCursor, current.cwd),
    model: keep(cursor, model, current.modelCursor, current.model),
    provider: keep(cursor, provider, current.providerCursor, current.provider),
    lastEvent: event.name,
    lastLifecycle: keep(cursor, lifecycle, current.lifecycleCursor, current.lastLifecycle),
    lastActivity: keep(cursor, activity, current.activityCursor, current.lastActivity),
    toolCount: current.toolCount + base.toolCount,
    errorCount: current.errorCount + base.errorCount,
    lossCount: current.lossCount + base.lossCount,
    cwdCursor: keptCursor(cursor, cwd, current.cwdCursor),
    modelCursor: keptCursor(cursor, model, current.modelCursor),
    providerCursor: keptCursor(cursor, provider, current.providerCursor),
    lifecycleCursor: keptCursor(cursor, lifecycle, current.lifecycleCursor),
    activityCursor: keptCursor(cursor, activity, current.activityCursor),
  };
}

export const RECORDINGS_DDL = `CREATE TABLE IF NOT EXISTS recordings (
  source TEXT NOT NULL, session TEXT NOT NULL, producer TEXT NOT NULL,
  first_cursor INTEGER NOT NULL, last_cursor INTEGER NOT NULL,
  first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL,
  event_count INTEGER NOT NULL, cwd TEXT, model TEXT, provider TEXT,
  last_event TEXT NOT NULL, last_lifecycle TEXT, last_activity TEXT,
  tool_count INTEGER NOT NULL, error_count INTEGER NOT NULL, loss_count INTEGER NOT NULL,
  cwd_cursor INTEGER NOT NULL, model_cursor INTEGER NOT NULL, provider_cursor INTEGER NOT NULL,
  lifecycle_cursor INTEGER NOT NULL, activity_cursor INTEGER NOT NULL,
  PRIMARY KEY (source, session, producer));
CREATE INDEX IF NOT EXISTS recordings_last_cursor ON recordings(last_cursor DESC);
CREATE TABLE IF NOT EXISTS summary_meta (id INTEGER PRIMARY KEY, built INTEGER NOT NULL);`;

export const sessionsSql = (bounded: boolean) =>
  `SELECT source, session AS sessionId, producer AS producerId,
    first_cursor AS firstCursor, last_cursor AS lastCursor,
    first_seen AS firstSeen, last_seen AS lastSeen, event_count AS eventCount,
    cwd, model, provider, last_event AS lastEvent, last_lifecycle AS lastLifecycle,
    last_activity AS lastActivity, tool_count AS toolCount, error_count AS errorCount,
    loss_count AS lossCount
  FROM recordings WHERE last_seen >= ? ${bounded ? "AND last_cursor < ?" : ""}
  ORDER BY last_cursor DESC LIMIT ?`;
