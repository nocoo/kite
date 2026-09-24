export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export interface TraceEvent {
  schemaVersion: 1;
  source: string;
  name: string;
  producerId: string;
  seq: number;
  timestamp: number;
  monotonicMs: number;
  correlation?: Record<string, string | number>;
  payload: Json;
}

export const MAX_EVENT_BYTES = 256 * 1024;
export const MAX_BATCH_BYTES = 1024 * 1024;
export const MAX_BATCH_EVENTS = 128;

export class InputError extends Error {}
export class ConflictError extends Error {}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateEvent(value: unknown): TraceEvent {
  if (!isRecord(value)) throw new InputError("Invalid event");
  for (const key of ["source", "name", "producerId"]) {
    const item = value[key];
    if (typeof item !== "string" || item.length === 0 || item.length > 256) {
      throw new InputError("Invalid event identity");
    }
  }
  if (
    value.schemaVersion !== 1 ||
    !Number.isSafeInteger(value.seq) ||
    (value.seq as number) < 1 ||
    typeof value.timestamp !== "number" ||
    !Number.isFinite(value.timestamp) ||
    value.timestamp < 0 ||
    typeof value.monotonicMs !== "number" ||
    !Number.isFinite(value.monotonicMs) ||
    value.monotonicMs < 0
  )
    throw new InputError("Invalid event clock");
  if (value.correlation !== undefined) {
    if (!isRecord(value.correlation) || Object.keys(value.correlation).length > 32) {
      throw new InputError("Invalid correlation");
    }
    for (const [key, item] of Object.entries(value.correlation)) {
      if (
        key.length > 128 ||
        !(
          (typeof item === "string" && item.length <= 1024) ||
          (typeof item === "number" && Number.isFinite(item))
        )
      )
        throw new InputError("Invalid correlation");
    }
  }
  let nodes = 0;
  function check(item: unknown, depth: number): void {
    if (++nodes > 20000 || depth > 32) throw new InputError("Payload exceeds structural limit");
    if (item === null || typeof item === "string" || typeof item === "boolean") return;
    if (typeof item === "number" && Number.isFinite(item)) return;
    if (Array.isArray(item)) {
      for (const child of item) check(child, depth + 1);
      return;
    }
    if (
      isRecord(item) &&
      (Object.getPrototypeOf(item) === Object.prototype || Object.getPrototypeOf(item) === null)
    ) {
      for (const child of Object.values(item)) check(child, depth + 1);
      return;
    }
    throw new InputError("Payload must be JSON");
  }
  check(value.payload, 0);
  if (Buffer.byteLength(JSON.stringify(value)) > MAX_EVENT_BYTES) throw new InputError("Event too large");
  return value as unknown as TraceEvent;
}

export function validateBatch(value: unknown): TraceEvent[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_BATCH_EVENTS) {
    throw new InputError("Invalid batch size");
  }
  return value.map(validateEvent);
}
