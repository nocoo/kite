import { DatabaseSync } from "node:sqlite";
import { ConflictError, InputError, type TraceEvent, validateBatch } from "./schema.ts";

export interface StoredEvent extends TraceEvent {
  cursor: number;
  receivedAt: number;
}
export interface Query {
  after?: number;
  limit?: number;
  sessionId?: string;
  source?: string;
}

export class EventStore {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS events (
        cursor INTEGER PRIMARY KEY AUTOINCREMENT, producer TEXT NOT NULL,
        seq INTEGER NOT NULL, source TEXT NOT NULL, session TEXT,
        received INTEGER NOT NULL, body TEXT NOT NULL, UNIQUE(producer, seq));
      CREATE INDEX IF NOT EXISTS events_session ON events(session, cursor);
      CREATE INDEX IF NOT EXISTS events_source ON events(source, cursor);`);
  }

  append(input: unknown): { accepted: number; inserted: number } {
    const events = validateBatch(input);
    const lookup = this.db.prepare("SELECT body FROM events WHERE producer=? AND seq=?");
    const insert = this.db.prepare(
      "INSERT INTO events(producer,seq,source,session,received,body) VALUES(?,?,?,?,?,?)",
    );
    let inserted = 0;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const event of events) {
        const body = JSON.stringify(event);
        const prior = lookup.get(event.producerId, event.seq);
        if (prior) {
          if (prior.body !== body) throw new ConflictError("Event identity conflict");
        } else {
          insert.run(
            event.producerId,
            event.seq,
            event.source,
            String(event.correlation?.sessionId ?? ""),
            Date.now(),
            body,
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

  query({ after = 0, limit = 100, sessionId, source }: Query = {}): StoredEvent[] {
    if (
      !Number.isSafeInteger(after) ||
      after < 0 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 1000
    ) {
      throw new InputError("Invalid cursor or limit");
    }
    const conditions = ["cursor > ?"];
    const params: (string | number)[] = [after];
    if (sessionId !== undefined) {
      conditions.push("session = ?");
      params.push(sessionId);
    }
    if (source !== undefined) {
      conditions.push("source = ?");
      params.push(source);
    }
    params.push(limit);
    const rows = this.db
      .prepare(
        `SELECT cursor,received,body FROM events WHERE ${conditions.join(" AND ")} ORDER BY cursor LIMIT ?`,
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
    return result;
  }

  close(): void {
    this.db.close();
  }
}
