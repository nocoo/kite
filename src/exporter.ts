import { isRecord, MAX_BATCH_BYTES, MAX_BATCH_EVENTS, type TraceEvent } from "./schema.ts";
import { localRequest } from "./transport.ts";

type Sender = (body: string, signal: AbortSignal) => Promise<{ status: number; body: unknown }>;
interface Item {
  body: string;
  bytes: number;
  delta: boolean;
}

export class Exporter {
  private queue: Item[] = [];
  private pending = new Set<Item>();
  private timer?: ReturnType<typeof setTimeout>;
  private flight?: Promise<void>;
  private controller?: AbortController;
  private active = false;
  private queuedBytes = 0;
  private stopped = false;
  private delay = 25;
  dropped = 0;
  private readonly send: Sender;

  constructor(
    socket: string,
    private readonly maxCount = 2048,
    private readonly maxBytes = 8 * 1024 * 1024,
    sender?: Sender,
  ) {
    this.send = sender ?? ((body, signal) => localRequest(socket, "/v1/events", body, signal));
  }

  get size(): number {
    return this.queue.length;
  }
  get bytes(): number {
    return this.queuedBytes;
  }

  enqueue(event: TraceEvent): void {
    if (this.stopped) {
      this.dropped++;
      return;
    }
    const body = JSON.stringify(event);
    const item = { body, bytes: Buffer.byteLength(body) + 1, delta: event.name === "message_update" };
    if (item.bytes > Math.min(this.maxBytes, MAX_BATCH_BYTES - 2)) {
      this.dropped++;
      return;
    }
    while (this.queue.length >= this.maxCount || this.bytes + item.bytes > this.maxBytes) {
      let index = this.queue.findIndex((entry) => entry.delta && !this.pending.has(entry));
      if (index < 0) index = this.queue.findIndex((entry) => !this.pending.has(entry));
      if (index < 0) {
        this.dropped++;
        return;
      }
      this.queuedBytes -= this.queue[index]?.bytes ?? 0;
      this.queue.splice(index, 1);
      this.dropped++;
    }
    this.queue.push(item);
    this.queuedBytes += item.bytes;
    this.schedule();
  }

  start(): void {
    if (!this.stopped) {
      this.active = true;
      this.schedule();
    }
  }

  private schedule(): void {
    if (!this.active || this.timer || this.flight || this.queue.length === 0) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.flush();
    }, this.delay);
    this.timer.unref();
  }

  flush(): Promise<void> {
    if (this.flight) return this.flight;
    if (this.stopped || this.queue.length === 0) return Promise.resolve();
    clearTimeout(this.timer);
    this.timer = undefined;
    let bytes = 2;
    const batch: Item[] = [];
    for (const item of this.queue) {
      if (batch.length === MAX_BATCH_EVENTS || bytes + item.bytes > MAX_BATCH_BYTES) break;
      batch.push(item);
      bytes += item.bytes;
    }
    this.pending = new Set(batch);
    this.controller = new AbortController();
    this.flight = (async () => {
      try {
        const response = await Promise.resolve().then(() =>
          this.send(`[${batch.map((item) => item.body).join(",")}]`, this.controller?.signal as AbortSignal),
        );
        if (this.stopped) return;
        const accepted =
          response.status === 200 && isRecord(response.body) && response.body.accepted === batch.length;
        const rejected = response.status >= 400 && response.status < 500 && response.status !== 429;
        if (accepted || rejected) {
          this.queue = this.queue.filter((item) => !this.pending.has(item));
          this.queuedBytes -= batch.reduce((sum, item) => sum + item.bytes, 0);
          if (rejected) this.dropped += batch.length;
          this.delay = 25;
        } else this.delay = Math.min(Math.max(this.delay * 2, 100), 5000);
      } catch {
        this.delay = Math.min(Math.max(this.delay * 2, 100), 5000);
      } finally {
        this.pending.clear();
        this.flight = undefined;
        this.controller = undefined;
        this.schedule();
      }
    })();
    return this.flight;
  }

  async close(timeoutMs = 250): Promise<void> {
    this.active = false;
    clearTimeout(this.timer);
    this.timer = undefined;
    if (this.stopped) return;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const drain = async () => {
      while (this.queue.length && !this.stopped) {
        const size = this.queue.length;
        await this.flush();
        if (this.queue.length >= size) break;
      }
    };
    try {
      await Promise.race([
        drain(),
        new Promise<void>((resolve) => {
          timeout = setTimeout(resolve, timeoutMs);
        }),
      ]);
    } finally {
      clearTimeout(timeout);
      this.stopped = true;
      this.controller?.abort();
      this.dropped += this.queue.length;
      this.queue = [];
      this.queuedBytes = 0;
    }
  }
}
