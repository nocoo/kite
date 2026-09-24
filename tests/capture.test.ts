import { describe, expect, it } from "vitest";
import { eventPayload, snapshot } from "../src/capture.ts";

describe("bounded immutable capture", () => {
  it("snapshots values without keeping mutable references", () => {
    const input = { list: [null, true, 1, "text"], nested: { ok: true } };
    const copy = snapshot(input);
    input.nested.ok = false;
    expect(copy).toEqual({ list: [null, true, 1, "text"], nested: { ok: true } });
  });
  it("redacts field credentials and headers, omits binary and images", () => {
    const captured = snapshot({
      apiKey: "private",
      token: "private",
      private_key: "private",
      authorization: "Bearer secret",
      headers: { x: "secret" },
      access_token: "secret",
      password: "secret",
      data: new Uint8Array(4),
      buffer: new ArrayBuffer(2),
      image: { type: "image", data: "base64" },
      url: { type: "image_url", image_url: "data:base64" },
      input: { type: "input_image" },
      harmless: "visible",
    });
    expect(JSON.stringify(captured)).not.toMatch(/"private"|Bearer|base64/);
    expect(captured).toMatchObject({ harmless: "visible", data: { _kiteOmitted: "binary" } });
  });
  it("handles special and unsupported values explicitly", () => {
    const controller = new AbortController();
    controller.abort();
    expect(
      snapshot([
        1n,
        undefined,
        () => 1,
        Symbol(),
        Infinity,
        new Date("invalid"),
        new Date(0),
        controller.signal,
        new Error("failure"),
      ]),
    ).toMatchObject([
      { _kiteBigInt: "1" },
      { _kiteOmitted: "undefined" },
      { _kiteOmitted: "function" },
      { _kiteOmitted: "symbol" },
      { _kiteOmitted: "non-finite" },
      { _kiteOmitted: "invalid-date" },
      "1970-01-01T00:00:00.000Z",
      { aborted: true },
      { name: "Error", message: "failure" },
    ]);
  });
  it("marks cycles and unreadable getters without executing toJSON", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    Object.defineProperty(cyclic, "bad", {
      enumerable: true,
      get() {
        throw new Error("private");
      },
    });
    expect(snapshot(cyclic)).toEqual({
      self: { _kiteOmitted: "cycle" },
      bad: { _kiteOmitted: "unreadable" },
    });
    expect(
      snapshot(
        new Proxy(
          {},
          {
            ownKeys() {
              throw new Error("proxy");
            },
          },
        ),
      ),
    ).toEqual({ _kiteOmitted: "unreadable" });
    const inherited = Object.create({ ignored: 1 });
    inherited.visible = 2;
    expect(snapshot(inherited)).toEqual({ visible: 2 });
  });
  it("bounds strings, utf8, arrays, objects, depth and node count", () => {
    for (const input of [
      "x".repeat(300000),
      "汉".repeat(100000),
      Array(10000).fill("x"),
      Object.fromEntries(Array.from({ length: 10000 }, (_, i) => [String(i), 1])),
    ]) {
      const result = JSON.stringify(snapshot(input));
      expect(Buffer.byteLength(result)).toBeLessThan(256 * 1024);
      expect(result).toMatch(/_kite(?:Omitted|Truncated)/);
    }
    let deep: unknown = 0;
    for (let i = 0; i < 20; i++) deep = { deep };
    expect(JSON.stringify(snapshot(deep))).toContain("limit");
    expect(snapshot({ ["x".repeat(1025)]: 1 })).toEqual({ _kiteOmitted: "limit" });
    expect(snapshot(1, 1)).toEqual({ _kiteOmitted: "limit" });
    expect(JSON.stringify(snapshot(Array(5000).fill(0), 10000000))).toContain("limit");
  });
  it("keeps delta metadata and usage, never cumulative streaming content", () => {
    const message = { content: "cumulative", usage: { output: 3 } };
    const partial = { content: [{ type: "toolCall", id: "call", name: "read", arguments: "huge" }] };
    expect(
      eventPayload({
        type: "message_update",
        message,
        assistantMessageEvent: {
          type: "toolcall_delta",
          contentIndex: 0,
          delta: "chunk",
          partial,
          message,
        },
      }),
    ).toEqual({
      type: "message_update",
      assistantMessageEvent: { type: "toolcall_delta", contentIndex: 0, delta: "chunk" },
      usage: { output: 3 },
      toolCallId: "call",
      toolName: "read",
    });
    expect(eventPayload({ type: "message_update" })).toMatchObject({ assistantMessageEvent: {} });
    expect(
      eventPayload({ type: "message_update", assistantMessageEvent: { partial: { content: [1] } } }),
    ).toBeTruthy();
    expect(eventPayload({ type: "message_end", message })).toMatchObject({ message });
  });
});
