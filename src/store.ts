import { DatabaseSync, type StatementSync } from "node:sqlite";
import { ConflictError, InputError, type TraceEvent, validateBatch } from "./schema.ts";
import {
  applyRecording,
  boundedText,
  MAX_CWD_CHARS,
  MAX_LABEL_CHARS,
  RECORDINGS_DDL,
  type RecordingUpdate,
  sessionsSql,
} from "./session-summary.ts";

export const RETENTION_DAYS = 7;
const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;

export interface StoredEvent extends TraceEvent {
  cursor: number;
  receivedAt: number;
}
export interface Query {
  after?: number;
  before?: number;
  limit?: number;
  sessionId?: string;
  source?: string;
  producerId?: string;
  tail?: boolean;
}
export interface SessionSummary {
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
}
export interface SessionPage {
  sessions: SessionSummary[];
  nextBefore: number | null;
  retentionDays: 7;
}

export class EventStore {
  private readonly db: DatabaseSync;
  private readonly lookupEvent: StatementSync;
  private readonly insertEvent: StatementSync;
  private readonly loadRecording: StatementSync;
  private readonly saveRecording: StatementSync;
  private readonly deleteRecording: StatementSync;
  private readonly recordingEvents: StatementSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS events (
        cursor INTEGER PRIMARY KEY AUTOINCREMENT, producer TEXT NOT NULL,
        seq INTEGER NOT NULL, source TEXT NOT NULL, session TEXT,
        received INTEGER NOT NULL, body TEXT NOT NULL, UNIQUE(producer, seq));
      CREATE INDEX IF NOT EXISTS events_session ON events(session, cursor);
      CREATE INDEX IF NOT EXISTS events_source ON events(source, cursor);
      CREATE INDEX IF NOT EXISTS events_received ON events(received);
      ${RECORDINGS_DDL}`);
    this.lookupEvent = this.db.prepare("SELECT body FROM events WHERE producer=? AND seq=?");
    this.insertEvent = this.db.prepare(
      "INSERT INTO events(producer,seq,source,session,received,body) VALUES(?,?,?,?,?,?)",
    );
    this.loadRecording = this.db.prepare(
      `SELECT source, session AS sessionId, producer AS producerId, first_cursor AS firstCursor,
        last_cursor AS lastCursor, first_seen AS firstSeen, last_seen AS lastSeen,
        event_count AS eventCount, cwd, model, provider, last_event AS lastEvent,
        last_lifecycle AS lastLifecycle, last_activity AS lastActivity,
        tool_count AS toolCount, error_count AS errorCount, loss_count AS lossCount,
        cwd_cursor AS cwdCursor, model_cursor AS modelCursor, provider_cursor AS providerCursor,
        lifecycle_cursor AS lifecycleCursor, activity_cursor AS activityCursor
      FROM recordings WHERE source=? AND session=? AND producer=?`,
    );
    this.saveRecording = this.db.prepare(
      `INSERT INTO recordings(source, session, producer, first_cursor, last_cursor, first_seen, last_seen,
        event_count, cwd, model, provider, last_event, last_lifecycle, last_activity, tool_count,
        error_count, loss_count, cwd_cursor, model_cursor, provider_cursor, lifecycle_cursor, activity_cursor)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(source, session, producer) DO UPDATE SET
        first_cursor=excluded.first_cursor, last_cursor=excluded.last_cursor,
        first_seen=excluded.first_seen, last_seen=excluded.last_seen, event_count=excluded.event_count,
        cwd=excluded.cwd, model=excluded.model, provider=excluded.provider, last_event=excluded.last_event,
        last_lifecycle=excluded.last_lifecycle, last_activity=excluded.last_activity,
        tool_count=excluded.tool_count, error_count=excluded.error_count, loss_count=excluded.loss_count,
        cwd_cursor=excluded.cwd_cursor, model_cursor=excluded.model_cursor,
        provider_cursor=excluded.provider_cursor, lifecycle_cursor=excluded.lifecycle_cursor,
        activity_cursor=excluded.activity_cursor`,
    );
    this.deleteRecording = this.db.prepare(
      "DELETE FROM recordings WHERE source=? AND session=? AND producer=?",
    );
    this.recordingEvents = this.db.prepare(
      `SELECT cursor, received, body FROM events
      WHERE source=? AND session=? AND producer=? AND received>=? ORDER BY cursor`,
    );
    try {
      this.ensureSummaries();
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  append(input: unknown): { accepted: number; inserted: number } {
    const events = validateBatch(input);
    let inserted = 0;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const event of events) {
        const body = JSON.stringify(event);
        const prior = this.lookupEvent.get(event.producerId, event.seq);
        if (prior) {
          if (prior.body !== body) throw new ConflictError("Event identity conflict");
        } else {
          const sessionId = String(event.correlation?.sessionId ?? "");
          const receivedAt = Date.now();
          const cursor = Number(
            this.insertEvent.run(event.producerId, event.seq, event.source, sessionId, receivedAt, body)
              .lastInsertRowid,
          );
          this.writeRecording(
            applyRecording(this.readRecording(event, sessionId), event, cursor, receivedAt, sessionId),
          );
          inserted++;
        }
      }
      this.db.exec("COMMIT");
      return { accepted: events.length, inserted };
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  query({
    after = 0,
    before,
    limit = 100,
    sessionId,
    source,
    producerId,
    tail = false,
  }: Query = {}): StoredEvent[] {
    if (
      !Number.isSafeInteger(after) ||
      after < 0 ||
      (before !== undefined && (!Number.isSafeInteger(before) || before < 0)) ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 1000 ||
      typeof tail !== "boolean"
    ) {
      throw new InputError("Invalid cursor or limit");
    }
    const conditions = ["cursor > ?", "received >= ?"];
    const params: (string | number)[] = [after, Date.now() - RETENTION_MS];
    if (before !== undefined) {
      conditions.push("cursor <= ?");
      params.push(before);
    }
    if (sessionId !== undefined) {
      conditions.push("session = ?");
      params.push(sessionId);
    }
    if (source !== undefined) {
      conditions.push("source = ?");
      params.push(source);
    }
    if (producerId !== undefined) {
      conditions.push("producer = ?");
      params.push(producerId);
    }
    params.push(limit);
    const rows = this.db
      .prepare(
        `SELECT cursor,received,body FROM events WHERE ${conditions.join(" AND ")} ORDER BY cursor ${tail ? "DESC" : "ASC"} LIMIT ?`,
      )
      .iterate(...params);
    const result: StoredEvent[] = [];
    let bytes = 0;
    for (const row of rows) {
      bytes += Buffer.byteLength(String(row.body)) + 128;
      if (bytes > 4 * 1024 * 1024) break;
      result.push({
        ...JSON.parse(String(row.body)),
        cursor: Number(row.cursor),
        receivedAt: Number(row.received),
      });
    }
    if (tail) result.reverse();
    return result;
  }

  sessions({ before, limit = 100 }: { before?: number; limit?: number } = {}): SessionPage {
    if (
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 200 ||
      (before !== undefined && (!Number.isSafeInteger(before) || before < 0))
    ) {
      throw new InputError("Invalid cursor or limit");
    }
    const params: number[] = [Date.now() - RETENTION_MS];
    if (before !== undefined) params.push(before);
    params.push(limit + 1);
    const rows = this.db.prepare(sessionsSql(before !== undefined)).all(...params);
    const sessions = rows.slice(0, limit).map((row) => this.summary(row));
    return {
      sessions,
      nextBefore: rows.length > limit ? (sessions.at(-1)?.lastCursor ?? null) : null,
      retentionDays: RETENTION_DAYS,
    };
  }

  prune(now = Date.now()): number {
    const cutoff = now - RETENTION_MS;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const deleted = Number(this.db.prepare("DELETE FROM events WHERE received < ?").run(cutoff).changes);
      const affected = this.db
        .prepare("SELECT source, session, producer FROM recordings WHERE first_seen < ?")
        .all(cutoff);
      for (const row of affected)
        this.rebuildRecording(String(row.source), String(row.session), String(row.producer), cutoff);
      this.db.exec("COMMIT");
      return deleted;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  close(): void {
    this.db.close();
  }

  private ensureSummaries(): void {
    if (this.db.prepare("SELECT built FROM summary_meta WHERE id=1").get()) return;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const groups = new Map<string, RecordingUpdate>();
      for (const row of this.db
        .prepare("SELECT cursor, received, body FROM events WHERE received >= ? ORDER BY cursor")
        .iterate(Date.now() - RETENTION_MS)) {
        const event = JSON.parse(String(row.body)) as TraceEvent;
        const sessionId = String(event.correlation?.sessionId ?? "");
        const key = `${event.source}\0${sessionId}\0${event.producerId}`;
        groups.set(
          key,
          applyRecording(groups.get(key), event, Number(row.cursor), Number(row.received), sessionId),
        );
      }
      for (const recording of groups.values()) this.writeRecording(recording);
      this.db.prepare("INSERT INTO summary_meta(id, built) VALUES (1, 1)").run();
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  private readRecording(
    event: Pick<TraceEvent, "source" | "producerId">,
    sessionId: string,
  ): RecordingUpdate | undefined {
    const row = this.loadRecording.get(event.source, sessionId, event.producerId);
    return row ? this.recording(row) : undefined;
  }

  private writeRecording(recording: RecordingUpdate): void {
    this.saveRecording.run(
      recording.source,
      recording.sessionId,
      recording.producerId,
      recording.firstCursor,
      recording.lastCursor,
      recording.firstSeen,
      recording.lastSeen,
      recording.eventCount,
      recording.cwd,
      recording.model,
      recording.provider,
      recording.lastEvent,
      recording.lastLifecycle,
      recording.lastActivity,
      recording.toolCount,
      recording.errorCount,
      recording.lossCount,
      recording.cwdCursor,
      recording.modelCursor,
      recording.providerCursor,
      recording.lifecycleCursor,
      recording.activityCursor,
    );
  }

  private rebuildRecording(source: string, sessionId: string, producerId: string, cutoff: number): void {
    this.deleteRecording.run(source, sessionId, producerId);
    let recording: RecordingUpdate | undefined;
    for (const row of this.recordingEvents.iterate(source, sessionId, producerId, cutoff)) {
      const event = JSON.parse(String(row.body)) as TraceEvent;
      recording = applyRecording(recording, event, Number(row.cursor), Number(row.received), sessionId);
    }
    if (recording) this.writeRecording(recording);
  }

  private recording(row: Record<string, unknown>): RecordingUpdate {
    const text = (key: string) => (typeof row[key] === "string" ? row[key] : null);
    return {
      source: String(row.source),
      sessionId: String(row.sessionId),
      producerId: String(row.producerId),
      firstCursor: Number(row.firstCursor),
      lastCursor: Number(row.lastCursor),
      firstSeen: Number(row.firstSeen),
      lastSeen: Number(row.lastSeen),
      eventCount: Number(row.eventCount),
      cwd: text("cwd"),
      model: text("model"),
      provider: text("provider"),
      lastEvent: String(row.lastEvent),
      lastLifecycle: text("lastLifecycle"),
      lastActivity: text("lastActivity"),
      toolCount: Number(row.toolCount),
      errorCount: Number(row.errorCount),
      lossCount: Number(row.lossCount),
      cwdCursor: Number(row.cwdCursor),
      modelCursor: Number(row.modelCursor),
      providerCursor: Number(row.providerCursor),
      lifecycleCursor: Number(row.lifecycleCursor),
      activityCursor: Number(row.activityCursor),
    };
  }

  private summary(row: Record<string, unknown>): SessionSummary {
    return {
      source: String(row.source),
      sessionId: String(row.sessionId),
      producerId: String(row.producerId),
      firstCursor: Number(row.firstCursor),
      lastCursor: Number(row.lastCursor),
      firstSeen: Number(row.firstSeen),
      lastSeen: Number(row.lastSeen),
      eventCount: Number(row.eventCount),
      cwd: boundedText(row.cwd, MAX_CWD_CHARS),
      model: boundedText(row.model, MAX_LABEL_CHARS),
      provider: boundedText(row.provider, MAX_LABEL_CHARS),
      lastEvent: String(row.lastEvent).slice(0, 256),
      lastLifecycle: boundedText(row.lastLifecycle, 256),
      lastActivity: boundedText(row.lastActivity, 256),
      toolCount: Number(row.toolCount),
      errorCount: Number(row.errorCount),
      lossCount: Number(row.lossCount),
    };
  }
}
