import { afterEach, describe, expect, it, vi } from "vitest";
import { Exporter } from "../src/exporter.ts";
import { event } from "./fixtures.ts";

afterEach(() => vi.useRealTimers());
const ack = (body: string): Promise<{ status: number; body: unknown }> =>
  Promise.resolve({ status: 200, body: { accepted: JSON.parse(body).length } });

describe("bounded background exporter", () => {
  it("does no IO before start, batches and releases acknowledged items", async () => {
    vi.useFakeTimers();
    const send = vi.fn(ack);
    const exporter = new Exporter("unused", 2048, 8000000, send);
    const input = event();
    exporter.enqueue(input);
    input.name = "changed";
    expect(send).not.toHaveBeenCalled();
    exporter.start();
    await vi.advanceTimersByTimeAsync(25);
    expect(JSON.parse(send.mock.calls[0]?.[0] ?? "[]")[0].name).toBe("anything");
    expect(exporter.size).toBe(0);
    expect(exporter.bytes).toBe(0);
    await exporter.close();
    await exporter.close();
    exporter.start();
    exporter.enqueue(event());
    expect(exporter.dropped).toBe(1);
    await exporter.flush();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("retries exact identities after loss of ACK, invalid ACK and throttling", async () => {
    const send = vi
      .fn(ack)
      .mockRejectedValueOnce(new Error("disconnect"))
      .mockResolvedValueOnce({ status: 200, body: { accepted: 0 } })
      .mockResolvedValueOnce({ status: 429, body: {} });
    const exporter = new Exporter("unused", 20, 100000, send);
    exporter.enqueue(event());
    for (let i = 0; i < 3; i++) {
      await exporter.flush();
      expect(exporter.size).toBe(1);
    }
    await exporter.flush();
    expect(exporter.size).toBe(0);
    expect(new Set(send.mock.calls.map((call) => call[0])).size).toBe(1);
    await exporter.close();
  });
  it.each([400, 409, 413])("drops a permanent %i batch so it cannot poison later events", async (status) => {
    const send = vi.fn(ack).mockResolvedValueOnce({ status, body: {} });
    const exporter = new Exporter("unused", 20, 100000, send);
    exporter.enqueue(event());
    await exporter.flush();
    expect(exporter.dropped).toBe(1);
    exporter.enqueue(event(2));
    await exporter.flush();
    expect(exporter.size).toBe(0);
    await exporter.close();
  });
  it("protects in-flight identities from overflow and favors dropping deltas", async () => {
    let finish: (value: { status: number; body: { accepted: number } }) => void = () => {};
    const exporter = new Exporter(
      "unused",
      2,
      100000,
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    exporter.enqueue(event());
    const first = exporter.flush();
    expect(exporter.flush()).toBe(first);
    await Promise.resolve();
    exporter.enqueue({ ...event(2), name: "message_update" });
    exporter.enqueue(event(3));
    expect(exporter.dropped).toBe(1);
    finish({ status: 200, body: { accepted: 1 } });
    await first;
    expect(exporter.size).toBe(1);
    const closing = exporter.close(0);
    await closing;
    expect(exporter.dropped).toBe(2);
  });
  it("rejects oversized items and bounds memory even with a stuck request", async () => {
    const exporter = new Exporter("unused", 1, 1000, () => new Promise(() => {}));
    exporter.enqueue({ ...event(), payload: { ok: true, text: "x".repeat(2000) } });
    expect(exporter.dropped).toBe(1);
    exporter.enqueue(event());
    void exporter.flush();
    exporter.enqueue(event(2));
    expect(exporter.dropped).toBe(2);
    await exporter.close(5);
    expect(exporter.size).toBe(0);
    expect(exporter.bytes).toBe(0);
  });
  it("evicts oldest events when there are no deltas and no in-flight batch", async () => {
    const send = vi.fn(ack);
    const exporter = new Exporter("unused", 1, 100000, send);
    exporter.enqueue(event());
    exporter.enqueue(event(2));
    await exporter.close();
    expect(JSON.parse(send.mock.calls[0]?.[0] ?? "[]")[0].seq).toBe(2);
    expect(exporter.dropped).toBe(1);
  });
  it("splits count and byte limits and drains multiple batches on close", async () => {
    const send = vi.fn(ack);
    const exporter = new Exporter("unused", 1000, 10000000, send);
    for (let i = 1; i <= 130; i++) exporter.enqueue(event(i));
    await exporter.close();
    expect(send).toHaveBeenCalledTimes(2);
    const bytes = new Exporter("unused", 100, 10000000, send);
    for (let i = 1; i <= 5; i++)
      bytes.enqueue({ ...event(i), payload: { ok: true, text: "x".repeat(250000) } });
    await bytes.close();
    expect(send).toHaveBeenCalledTimes(4);
  });
  it("caps backoff and cancels all owned timers on shutdown", async () => {
    vi.useFakeTimers();
    const send = vi.fn().mockResolvedValue({ status: 503, body: null });
    const exporter = new Exporter("unused", 20, 100000, send);
    exporter.enqueue(event());
    exporter.start();
    await vi.advanceTimersByTimeAsync(20000);
    expect(send.mock.calls.length).toBeLessThan(15);
    await exporter.close();
    expect(vi.getTimerCount()).toBe(0);
    expect(exporter.dropped).toBe(1);
  });
  it("uses the real transport and contains a missing collector", async () => {
    const exporter = new Exporter("/tmp/kite-does-not-exist.sock");
    exporter.enqueue(event());
    await exporter.flush();
    expect(exporter.size).toBe(1);
    await exporter.close();
    expect(exporter.dropped).toBe(1);
  });
});
