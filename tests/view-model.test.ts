import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionSummary, StoredEvent } from "../src/store.ts";
import { api, boundedEvents, Observatory } from "../web/view-model.ts";
import { event } from "./fixtures.ts";

const session = (patch: Partial<SessionSummary> = {}): SessionSummary => ({
  source: "pi",
  sessionId: "s",
  producerId: "producer",
  firstCursor: 1,
  lastCursor: 3,
  firstSeen: 1000,
  lastSeen: 2000,
  eventCount: 3,
  cwd: "/work/kite",
  model: "test",
  provider: "local",
  lastEvent: "agent_end",
  lastLifecycle: "agent_end",
  lastActivity: "input",
  toolCount: 0,
  errorCount: 0,
  lossCount: 0,
  ...patch,
});
const events = (count = 3, start = 1): StoredEvent[] =>
  Array.from({ length: count }, (_, i) => ({
    ...event(i + start),
    source: "pi",
    cursor: i + start,
    receivedAt: 1000,
    monotonicMs: (i + start) * 1000,
  }));
function service() {
  let sessions = [session()];
  let trace = events();
  const request = vi.fn(async (path: string, _signal: AbortSignal): Promise<unknown> => {
    const url = new URL(path, "https://kite.test/");
    if (path.startsWith("sessions")) return { sessions, nextBefore: null };
    const after = Number(url.searchParams.get("after"));
    const before = Number(url.searchParams.get("before"));
    const matching = trace.filter((e) => e.cursor > after && e.cursor <= before);
    return { events: url.searchParams.get("tail") === "1" ? matching.slice(-500) : matching.slice(0, 500) };
  });
  const vm = new Observatory(request as typeof api);
  return {
    vm,
    request,
    update: (nextSessions: SessionSummary[], nextEvents = trace) => {
      sessions = nextSessions;
      trace = nextEvents;
    },
  };
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("local API", () => {
  it("sets the observer header, passes cancellation and rejects errors", async () => {
    const signal = new AbortController().signal;
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetcher);
    expect(await api("health", signal)).toEqual({ ok: true });
    expect(fetcher).toHaveBeenCalledWith("/api/health", { signal, headers: { "x-kite-client": "1" } });
    fetcher.mockResolvedValue({ ok: false, status: 503 });
    await expect(api("health", signal)).rejects.toThrow("Collector is offline");
    fetcher.mockResolvedValue({ ok: false, status: 400 });
    await expect(api("events", signal)).rejects.toThrow("Request failed (400)");
  });
});

describe("observation ViewModel", () => {
  it("publishes immutable snapshots, filters and refreshed summaries", async () => {
    const { vm, request, update } = service();
    const listener = vi.fn();
    const unsubscribe = vm.subscribe(listener);
    const initial = vm.getSnapshot();
    await vm.refresh();
    expect(vm.getSnapshot()).toMatchObject({ loading: false, connected: true, sessions: [session()] });
    expect(initial.loading).toBe(true);
    vm.setFilter("tools");
    vm.setSearch("read");
    vm.setSessionSearch("kite");
    vm.setSpeed(4);
    vm.setSpeed(3);
    vm.setPace("recorded");
    expect(vm.getSnapshot()).toMatchObject({
      filter: "tools",
      search: "read",
      sessionSearch: "kite",
      speed: 4,
      pace: "recorded",
    });
    await vm.select(session());
    expect(vm.getSnapshot().events).toHaveLength(3);
    update([session({ lastCursor: 4 })], events(4));
    await vm.refresh();
    expect(vm.getSnapshot().events).toHaveLength(4);
    expect(vm.getSnapshot().index).toBe(3);
    const eventCalls = request.mock.calls.filter(([path]) => path.startsWith("events"));
    expect(eventCalls.at(-1)?.[0]).toContain("after=3");
    update([]);
    await vm.refresh();
    expect(vm.getSnapshot()).toMatchObject({
      events: [],
      detailError: "This recording is no longer retained.",
    });
    await vm.select(null);
    expect(vm.getSnapshot().selected).toBeNull();
    const count = listener.mock.calls.length;
    unsubscribe();
    vm.setSearch("a");
    expect(listener).toHaveBeenCalledTimes(count);
    await vm.loadPage(-1);
    await vm.loadLive();
    vm.play();
    vm.tick(1);
    expect(vm.getSnapshot().playing).toBe(false);
  });
  it("deduplicates summary pages and fails nonadvancing pagination", async () => {
    const { vm, request } = service();
    request
      .mockResolvedValueOnce({ sessions: [session()], nextBefore: 3 })
      .mockResolvedValueOnce({ sessions: [session()], nextBefore: null });
    await vm.refresh();
    expect(vm.getSnapshot().sessions).toHaveLength(1);
    expect(request.mock.calls[1]?.[0]).toContain("before=3");
    request.mockResolvedValue({ sessions: [], nextBefore: 3 });
    await vm.refresh();
    expect(vm.getSnapshot()).toMatchObject({ connected: false, error: "Session pagination did not advance" });
    request.mockRejectedValue("offline");
    await vm.refresh();
    expect(vm.getSnapshot().error).toBe("Connection failed");
  });
  it("plays every step and recorded timing, clamps seeks and stops at the end", async () => {
    const { vm } = service();
    await vm.select(session());
    expect(vm.getSnapshot().index).toBe(2);
    vm.play();
    expect(vm.getSnapshot()).toMatchObject({ index: 0, playing: true, mode: "replay" });
    vm.tick(200);
    expect(vm.getSnapshot().index).toBe(0);
    vm.tick(200);
    expect(vm.getSnapshot().index).toBe(1);
    vm.play();
    expect(vm.getSnapshot().playing).toBe(false);
    vm.play();
    vm.tick(400);
    expect(vm.getSnapshot()).toMatchObject({ index: 2, playing: false });
    vm.seek(-1);
    expect(vm.getSnapshot().index).toBe(0);
    vm.seek(999);
    expect(vm.getSnapshot().index).toBe(2);
    vm.seek(Number.NaN);
    expect(vm.getSnapshot().index).toBe(2);
    vm.seek(0);
    vm.setPace("recorded");
    vm.setSpeed(2);
    vm.play();
    vm.tick(500);
    expect(vm.getSnapshot().index).toBe(1);
    vm.tick(0);
    vm.tick(-1);
    vm.tick(Number.NaN);
    expect(vm.getSnapshot().index).toBe(1);
    vm.tick(600);
    expect(vm.getSnapshot().playing).toBe(false);
    await vm.live();
    expect(vm.getSnapshot()).toMatchObject({ mode: "live", index: 2 });
    await vm.replay();
    expect(vm.getSnapshot()).toMatchObject({ mode: "replay", index: 0 });
    await vm.page(-1);
    await vm.page(1);
    expect(vm.getSnapshot().page).toBe(0);
    await vm.loadPage(99);
    await vm.retryDetail();
    await vm.live();
    await vm.retryDetail();
  });
  it("starts a fresh step interval when changing from recorded pacing", async () => {
    const { vm, update } = service();
    const summary = session({ lastCursor: 100 });
    update([summary], events(100));
    await vm.select(summary);
    await vm.replay();
    vm.setPace("recorded");
    vm.play();
    vm.tick(10000);
    expect(vm.getSnapshot().index).toBe(10);
    vm.setPace("steps");
    vm.tick(100);
    expect(vm.getSnapshot().index).toBe(10);
    vm.tick(299);
    expect(vm.getSnapshot().index).toBe(10);
    vm.tick(1);
    expect(vm.getSnapshot().index).toBe(11);
    vm.setPace("recorded");
    vm.tick(1000);
    expect(vm.getSnapshot().index).toBe(12);
  });
  it("replays across bounded segments and can return to a previous segment", async () => {
    const { vm, update } = service();
    const big = session({ lastCursor: 502, eventCount: 502 });
    update([big], events(502));
    await vm.select(big);
    expect(vm.getSnapshot().events).toHaveLength(500);
    expect(vm.getSnapshot().events[0]?.cursor).toBe(3);
    await vm.replay();
    expect(vm.getSnapshot()).toMatchObject({ page: 0, hasNext: true, index: 0 });
    expect(vm.getSnapshot().events.at(-1)?.cursor).toBe(500);
    await vm.page(1);
    expect(vm.getSnapshot()).toMatchObject({ page: 1, hasNext: false });
    expect(vm.getSnapshot().events[0]?.cursor).toBe(501);
    await vm.page(-1);
    expect(vm.getSnapshot().events[0]?.cursor).toBe(1);
    vm.seek(498);
    vm.play();
    vm.tick(800);
    await vi.waitFor(() => expect(vm.getSnapshot().page).toBe(1));
    expect(vm.getSnapshot().playing).toBe(true);
    vm.tick(400);
    expect(vm.getSnapshot().playing).toBe(false);
    await vm.refresh();
    expect(vm.getSnapshot().mode).toBe("replay");
  });
  it("bounds reconnect catch-up to the newest page and sorts summary activity", async () => {
    const { vm, update, request } = service();
    await vm.select(session());
    update(
      [session({ lastCursor: 9000 }), session({ producerId: "other", lastCursor: 10000 })],
      events(9000),
    );
    const before = request.mock.calls.length;
    await vm.refresh();
    expect(request.mock.calls.length - before).toBe(2);
    expect(vm.getSnapshot().events).toHaveLength(500);
    expect(vm.getSnapshot().events[0]?.cursor).toBe(8501);
    expect(vm.getSnapshot().events.at(-1)?.cursor).toBe(9000);
    expect(vm.getSnapshot().sessions[0]?.producerId).toBe("other");
  });
  it("freezes the replay upper cursor while the session keeps receiving events", async () => {
    const { vm, update } = service();
    const original = session({ lastCursor: 501 });
    update([original], events(501));
    await vm.select(original);
    await vm.replay();
    update([session({ lastCursor: 700 })], events(700));
    await vm.refresh();
    await vm.page(1);
    expect(vm.getSnapshot().events.map((e) => e.cursor)).toEqual([501]);
    expect(vm.getSnapshot().hasNext).toBe(false);
    await vm.live();
    expect(vm.getSnapshot().events.at(-1)?.cursor).toBe(700);
  });
  it("preserves the recorded gap across pages, supports pause and cancels buffered pages", async () => {
    const { vm, update } = service();
    const trace = events(501).map((event, index) => ({ ...event, monotonicMs: index < 500 ? index : 60000 }));
    const summary = session({ lastCursor: 501 });
    update([summary], trace);
    await vm.select(summary);
    await vm.replay();
    vm.setPace("recorded");
    vm.seek(499);
    vm.play();
    vm.tick(1);
    await vi.waitFor(() => expect(vm.getSnapshot().detailLoading).toBe(false));
    expect(vm.getSnapshot()).toMatchObject({ page: 0, index: 499, time: 500 });
    vm.play();
    vm.tick(10000);
    expect(vm.getSnapshot().time).toBe(500);
    vm.play();
    vm.tick(59499);
    expect(vm.getSnapshot()).toMatchObject({ page: 0, index: 499, time: 59999 });
    vm.tick(1);
    expect(vm.getSnapshot()).toMatchObject({ page: 1, index: 0, time: 60000, playing: false });
    await vm.replay();
    vm.seek(499);
    vm.play();
    vm.tick(1);
    await vi.waitFor(() => expect(vm.getSnapshot().detailLoading).toBe(false));
    vm.setPace("steps");
    expect(vm.getSnapshot().page).toBe(1);
    await vm.replay();
    vm.setPace("recorded");
    vm.seek(499);
    vm.play();
    vm.tick(1);
    await vi.waitFor(() => expect(vm.getSnapshot().detailLoading).toBe(false));
    vm.seek(0);
    vm.tick(60000);
    expect(vm.getSnapshot()).toMatchObject({ page: 0, index: 0, playing: false });
    await vm.replay();
    vm.seek(499);
    vm.play();
    vm.tick(100000);
    await vi.waitFor(() => expect(vm.getSnapshot().page).toBe(1));
    expect(vm.getSnapshot().playing).toBe(false);
  });
  it("retains error states, retries and handles empty or nonadvancing event pages", async () => {
    const { vm, request } = service();
    request.mockRejectedValueOnce(new Error("disk unavailable"));
    await vm.select(session());
    expect(vm.getSnapshot()).toMatchObject({ detailLoading: false, detailError: "disk unavailable" });
    request.mockRejectedValueOnce("broken");
    await vm.loadLive();
    expect(vm.getSnapshot().detailError).toBe("Could not load recording");
    request.mockRejectedValueOnce("broken");
    await vm.replay();
    expect(vm.getSnapshot().detailError).toBe("Could not load recording");
    request.mockRejectedValueOnce(new Error("bad page"));
    await vm.loadPage(0);
    expect(vm.getSnapshot().detailError).toBe("bad page");
    request.mockResolvedValueOnce({ events: [] });
    await vm.loadPage(0);
    expect(vm.getSnapshot()).toMatchObject({ index: -1, hasNext: false, detailLoading: false });
    vm.seek(0);
    expect(vm.getSnapshot().time).toBe(0);
    vm.play();
    expect(vm.getSnapshot().playing).toBe(false);
    request.mockResolvedValueOnce({ events: [] });
    await vm.live();
    expect(vm.getSnapshot().index).toBe(-1);
    request.mockResolvedValueOnce({ events: events(1, 0) });
    await vm.live();
    expect(vm.getSnapshot().detailError).toBe("Event pagination did not advance");
    await vm.live();
    expect(vm.getSnapshot().events).toHaveLength(3);
  });
  it("cancels obsolete overview and detail requests on selection or stop", async () => {
    const { vm, request } = service();
    let release: ((value: unknown) => void) | undefined;
    request.mockImplementationOnce(
      async () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const pending = vm.select(session());
    expect(vm.getSnapshot().detailLoading).toBe(true);
    vm.play();
    expect(vm.getSnapshot().playing).toBe(false);
    await vm.select(null);
    release?.({ events: events() });
    await pending;
    expect(vm.getSnapshot().events).toEqual([]);
    request.mockImplementationOnce(
      async () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const overview = vm.refresh();
    vm.stop();
    release?.({ sessions: [session()], nextBefore: null });
    await overview;
    expect(vm.getSnapshot().sessions).toEqual([]);
    await vm.select(session());
    request.mockImplementationOnce(
      async () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const page = vm.replay();
    vm.stop();
    release?.({ events: events() });
    await page;
    expect(vm.getSnapshot().mode).toBe("replay");
    request.mockImplementationOnce(async (_path, signal) => {
      vm.stop();
      if (signal.aborted) throw new Error("Abort");
      return {};
    });
    await vm.refresh();
    expect(vm.getSnapshot().error).toBe("");
    request.mockImplementationOnce(async () => {
      vm.stop();
      throw new Error("Abort");
    });
    await vm.loadPage(0);
    expect(vm.getSnapshot().detailError).toBe("");
    request.mockImplementationOnce(async () => {
      vm.stop();
      throw new Error("Abort");
    });
    await vm.loadLive();
    expect(vm.getSnapshot().detailError).toBe("");
  });
  it("preserves sparse recording cursors and cancels a live response when seeking", async () => {
    const { vm, update, request } = service();
    const sparse = session({ lastCursor: 1000 });
    const trace = [events(1, 1)[0], events(1, 2)[0], events(1, 1000)[0]] as StoredEvent[];
    update([sparse], trace);
    await vm.select(sparse);
    expect(vm.getSnapshot().events.map((event) => event.cursor)).toEqual([1, 2, 1000]);
    let release: ((value: unknown) => void) | undefined;
    request.mockImplementationOnce(
      async () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const loading = vm.loadPage(0);
    vm.seek(0);
    release?.({ events: events(2, 900) });
    await loading;
    expect(vm.getSnapshot()).toMatchObject({ mode: "replay", index: 0, detailLoading: false });
    expect(vm.getSnapshot().events.map((event) => event.cursor)).toEqual([1, 2, 1000]);
  });
  it("starts only one polling loop and releases its timers", async () => {
    vi.useFakeTimers();
    const { vm, request } = service();
    vm.start();
    vm.start();
    await vi.advanceTimersByTimeAsync(1);
    expect(request).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(request).toHaveBeenCalledTimes(2);
    vm.stop();
    await vi.advanceTimersByTimeAsync(3000);
    expect(request).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ sessions: [], nextBefore: null }) }),
    );
    const real = new Observatory();
    await real.refresh();
    expect(real.getSnapshot().connected).toBe(true);
    real.stop();
  });
  it("bounds the live window by both event count and serialized memory", () => {
    expect(boundedEvents(events(600))).toHaveLength(500);
    const large = events(10).map((e) => ({ ...e, payload: "x".repeat(600_000) }));
    const bounded = boundedEvents(large);
    expect(bounded.length).toBeLessThan(10);
    expect(bounded.at(-1)?.cursor).toBe(10);
    expect(boundedEvents([])).toEqual([]);
  });
});
