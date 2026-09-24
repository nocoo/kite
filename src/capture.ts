import { isRecord, type Json } from "./schema.ts";

const privateKey =
  /^(?:.*(?:api[-_]?key|authorization|password|secret|credential|access[-_]?token|refresh[-_]?token)|cookie|set-cookie|headers)$/i;
const marker = (reason: string): Json => ({ _kiteOmitted: reason });

export function snapshot(value: unknown, maxBytes = 192 * 1024): Json {
  const seen = new WeakSet<object>();
  let remaining = maxBytes;
  let nodes = 0;
  function visit(item: unknown, depth: number): Json {
    if (++nodes > 4096 || depth > 16 || remaining < 64) return marker("limit");
    remaining -= 32;
    if (item === null || typeof item === "boolean") return item;
    if (typeof item === "number") return Number.isFinite(item) ? item : marker("non-finite");
    if (typeof item === "string") {
      const limit = Math.min(remaining, 64 * 1024);
      const bytes = Buffer.from(item.slice(0, limit));
      const text = bytes.subarray(0, limit).toString("utf8");
      remaining -= Buffer.byteLength(text);
      return item.length > limit || bytes.length > limit ? { text, _kiteTruncated: true } : text;
    }
    if (typeof item === "bigint") return { _kiteBigInt: String(item) };
    if (typeof item !== "object") return marker(typeof item);
    if (seen.has(item)) return marker("cycle");
    if (ArrayBuffer.isView(item) || item instanceof ArrayBuffer) return marker("binary");
    if (item instanceof AbortSignal) return { aborted: item.aborted };
    if (item instanceof Error)
      return visit({ name: item.name, message: item.message, stack: item.stack }, depth + 1);
    if (item instanceof Date)
      return Number.isNaN(item.valueOf()) ? marker("invalid-date") : item.toISOString();
    seen.add(item);
    if (Array.isArray(item)) {
      const result: Json[] = [];
      for (const child of item) {
        if (remaining < 64 || nodes >= 4096) {
          result.push(marker("limit"));
          break;
        }
        result.push(visit(child, depth + 1));
      }
      return result;
    }
    if (
      isRecord(item) &&
      (item.type === "image" || item.type === "image_url" || item.type === "input_image")
    ) {
      return { type: item.type, _kiteOmitted: "image" };
    }
    const result: Record<string, Json> = Object.create(null);
    for (const key in item) {
      if (!Object.hasOwn(item, key)) continue;
      if (remaining < 64 || nodes >= 4096 || key.length > 1024) {
        result._kiteOmitted = "limit";
        break;
      }
      remaining -= Buffer.byteLength(key);
      try {
        result[key] = privateKey.test(key)
          ? marker("redacted")
          : visit((item as Record<string, unknown>)[key], depth + 1);
      } catch {
        result[key] = marker("unreadable");
      }
    }
    return result;
  }
  try {
    return visit(value, 0);
  } catch {
    return marker("unreadable");
  }
}

export function eventPayload(event: Record<string, unknown>): Json {
  if (event.type !== "message_update") return snapshot(event);
  const update = isRecord(event.assistantMessageEvent) ? event.assistantMessageEvent : {};
  const { partial: _partial, message: _message, ...delta } = update;
  const message = isRecord(event.message) ? event.message : {};
  const partial = isRecord(update.partial) ? update.partial : {};
  const blocks = Array.isArray(partial.content) ? partial.content : [];
  const block = blocks[typeof update.contentIndex === "number" ? update.contentIndex : -1];
  return snapshot({
    type: event.type,
    assistantMessageEvent: delta,
    usage: message.usage,
    ...(isRecord(block) && block.type === "toolCall" ? { toolCallId: block.id, toolName: block.name } : {}),
  });
}
