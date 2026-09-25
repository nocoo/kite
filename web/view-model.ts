import type { SessionSummary, StoredEvent } from "../src/store.ts";
import { type ModuleId, replayIndex, replayTimes, sessionKey } from "./model.ts";

export interface ObservatoryState {
  sessions: SessionSummary[];
  selected: SessionSummary | null;
  events: StoredEvent[];
  index: number;
  mode: "live" | "replay";
  playing: boolean;
  pace: "steps" | "recorded";
  speed: number;
  time: number;
  now: number;
  connected: boolean;
  loading: boolean;
  detailLoading: boolean;
  error: string;
  detailError: string;
  filter: ModuleId | "all";
  search: string;
  sessionSearch: string;
  page: number;
  hasNext: boolean;
}

export async function api<T>(path: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(`/api/${path}`, { signal, headers: { "x-kite-client": "1" } });
  if (!response.ok)
    throw new Error(response.status === 503 ? "Collector is offline" : `Request failed (${response.status})`);
  return response.json() as Promise<T>;
}
type Request = typeof api;

export class Observatory {
  private state: ObservatoryState = {
    sessions: [],
    selected: null,
    events: [],
    index: -1,
    mode: "live",
    playing: false,
    pace: "steps",
    speed: 1,
    time: 0,
    now: Date.now(),
    connected: false,
    loading: true,
    detailLoading: false,
    error: "",
    detailError: "",
    filter: "all",
    search: "",
    sessionSearch: "",
    page: 0,
    hasNext: false,
  };
  private listeners = new Set<() => void>();
  private pollTimer?: ReturnType<typeof setTimeout>;
  private playTimer?: ReturnType<typeof setInterval>;
  private overviewRequest?: AbortController;
  private detailRequest?: AbortController;
  private running = false;
  private pages = [0];
  private times: number[] = [];
  private playElapsed = 0;
  private replayEnd = 0;

  constructor(private readonly request: Request = api) {}
  getSnapshot = (): ObservatoryState => this.state;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private patch(value: Partial<ObservatoryState>): void {
    this.state = { ...this.state, ...value };
    for (const listener of this.listeners) listener();
  }
  start(): void {
    if (this.running) return;
    this.running = true;
    void this.refresh();
    this.playTimer = setInterval(() => this.tick(100), 100);
  }
  stop(): void {
    this.running = false;
    clearTimeout(this.pollTimer);
    clearInterval(this.playTimer);
    this.overviewRequest?.abort();
    this.detailRequest?.abort();
  }
  async refresh(): Promise<void> {
    clearTimeout(this.pollTimer);
    this.overviewRequest?.abort();
    const controller = new AbortController();
    this.overviewRequest = controller;
    try {
      const sessions = new Map<string, SessionSummary>();
      let before: number | null = null;
      do {
        const result: { sessions: SessionSummary[]; nextBefore: number | null } = await this.request(
          `sessions?limit=200${before === null ? "" : `&before=${before}`}`,
          controller.signal,
        );
        if (controller.signal.aborted) return;
        for (const session of result.sessions) sessions.set(sessionKey(session), session);
        if (result.nextBefore !== null && before !== null && result.nextBefore >= before)
          throw new Error("Session pagination did not advance");
        before = result.nextBefore;
      } while (before !== null);
      const selected = this.state.selected;
      const updated = selected ? sessions.get(sessionKey(selected)) : undefined;
      this.patch({
        sessions: [...sessions.values()],
        connected: true,
        loading: false,
        error: "",
        now: Date.now(),
        ...(updated ? { selected: updated } : {}),
      });
      if (selected && !updated) {
        this.detailRequest?.abort();
        this.patch({
          events: [],
          index: -1,
          playing: false,
          detailLoading: false,
          detailError: "This recording is no longer retained.",
          hasNext: false,
        });
      } else if (
        updated &&
        this.state.mode === "live" &&
        !this.state.detailLoading &&
        updated.lastCursor > (this.state.events.at(-1)?.cursor ?? 0)
      ) {
        await this.loadLive();
      }
    } catch (error) {
      if (!controller.signal.aborted)
        this.patch({
          connected: false,
          loading: false,
          error: error instanceof Error ? error.message : "Connection failed",
          now: Date.now(),
        });
    } finally {
      if (this.running && !controller.signal.aborted)
        this.pollTimer = setTimeout(() => {
          void this.refresh();
        }, 1000);
    }
  }
  async select(session: SessionSummary | null): Promise<void> {
    this.detailRequest?.abort();
    this.pages = [0];
    this.replayEnd = 0;
    this.patch({
      selected: session,
      events: [],
      index: -1,
      page: 0,
      mode: "live",
      playing: false,
      filter: "all",
      search: "",
      detailError: "",
      hasNext: false,
      detailLoading: false,
    });
    if (session) await this.loadLive();
  }
  async loadPage(page: number): Promise<void> {
    const session = this.state.selected;
    const after = this.pages[page];
    const upper = this.replayEnd || session?.lastCursor || 0;
    if (!session || after === undefined || page < 0) return;
    this.detailRequest?.abort();
    const controller = new AbortController();
    this.detailRequest = controller;
    this.patch({ detailLoading: true, detailError: "" });
    try {
      const params = new URLSearchParams({
        sessionId: session.sessionId,
        source: session.source,
        producerId: session.producerId,
        after: String(after),
        before: String(upper),
        limit: "500",
      });
      const { events } = await this.request<{ events: StoredEvent[] }>(`events?${params}`, controller.signal);
      if (controller.signal.aborted) return;
      this.times = replayTimes(events);
      const last = events.at(-1)?.cursor ?? after;
      const hasNext = events.length > 0 && last < upper;
      this.pages[page + 1] = last;
      this.patch({
        events,
        index: events.length ? 0 : -1,
        page,
        hasNext,
        detailLoading: false,
        time: 0,
      });
    } catch (error) {
      if (!controller.signal.aborted)
        this.patch({
          detailLoading: false,
          playing: false,
          detailError: error instanceof Error ? error.message : "Could not load recording",
        });
    }
  }
  async loadLive(): Promise<void> {
    const session = this.state.selected;
    if (!session) return;
    this.detailRequest?.abort();
    const controller = new AbortController();
    this.detailRequest = controller;
    this.patch({ detailLoading: true, detailError: "" });
    try {
      let after = this.state.events.at(-1)?.cursor ?? 0;
      let events = this.state.events;
      while (after < session.lastCursor) {
        const params = new URLSearchParams({
          source: session.source,
          sessionId: session.sessionId,
          producerId: session.producerId,
          tail: after === 0 ? "1" : "0",
          after: String(after),
          before: String(session.lastCursor),
          limit: "500",
        });
        const result = await this.request<{ events: StoredEvent[] }>(`events?${params}`, controller.signal);
        if (controller.signal.aborted) return;
        const last = result.events.at(-1)?.cursor;
        if (last === undefined) break;
        if (last <= after) throw new Error("Event pagination did not advance");
        events = boundedEvents([...events, ...result.events]);
        after = last;
      }
      this.times = replayTimes(events);
      this.patch({
        events,
        index: events.length - 1,
        time: this.times.at(-1) ?? 0,
        page: 0,
        detailLoading: false,
        hasNext: false,
      });
    } catch (error) {
      if (!controller.signal.aborted)
        this.patch({
          detailLoading: false,
          detailError: error instanceof Error ? error.message : "Could not load recording",
        });
    }
  }
  async page(direction: -1 | 1): Promise<void> {
    if ((direction === 1 && !this.state.hasNext) || (direction === -1 && this.state.page === 0)) return;
    this.patch({ mode: "replay", playing: false });
    await this.loadPage(this.state.page + direction);
  }
  seek(index: number): void {
    if (!Number.isFinite(index)) return;
    if (this.state.mode === "live") this.replayEnd = this.state.selected?.lastCursor ?? 0;
    const next = Math.max(0, Math.min(this.state.events.length - 1, Math.floor(index)));
    this.detailRequest?.abort();
    this.playElapsed = 0;
    this.patch({
      detailLoading: false,
      index: next,
      time: this.times[next] ?? 0,
      mode: "replay",
      playing: false,
    });
  }
  async replay(): Promise<void> {
    this.pages = [0];
    this.replayEnd = this.state.selected?.lastCursor ?? 0;
    this.patch({ mode: "replay", playing: false });
    await this.loadPage(0);
  }
  async retryDetail(): Promise<void> {
    if (this.state.mode === "live") await this.loadLive();
    else await this.loadPage(this.state.page);
  }
  async live(): Promise<void> {
    this.replayEnd = 0;
    this.patch({ mode: "live", playing: false, events: [] });
    await this.loadLive();
  }
  play(): void {
    if (this.state.events.length === 0 || this.state.detailLoading) return;
    if (this.state.index >= this.state.events.length - 1 && !this.state.hasNext) this.seek(0);
    this.playElapsed = 0;
    this.patch({ mode: "replay", playing: !this.state.playing });
  }
  setSpeed(speed: number): void {
    if ([0.5, 1, 2, 4, 8].includes(speed)) this.patch({ speed });
  }
  setPace(pace: "steps" | "recorded"): void {
    this.patch({ pace });
  }
  setFilter(filter: ModuleId | "all"): void {
    this.patch({ filter });
  }
  setSearch(search: string): void {
    this.patch({ search });
  }
  setSessionSearch(sessionSearch: string): void {
    this.patch({ sessionSearch });
  }
  tick(elapsed: number): void {
    if (!this.state.playing || this.state.detailLoading || elapsed <= 0 || !Number.isFinite(elapsed)) return;
    const state = this.state;
    this.playElapsed += elapsed * state.speed;
    const time = state.time + elapsed * state.speed;
    const index =
      state.pace === "recorded"
        ? replayIndex(this.times, time)
        : Math.min(state.events.length - 1, state.index + Math.floor(this.playElapsed / 400));
    if (state.pace === "steps") this.playElapsed %= 400;
    this.patch({ index, time: state.pace === "recorded" ? time : (this.times[index] ?? 0) });
    if (index >= state.events.length - 1) {
      if (state.hasNext) void this.loadPage(state.page + 1);
      else this.patch({ playing: false });
    }
  }
}

export function boundedEvents(events: StoredEvent[]): StoredEvent[] {
  let bytes = 0;
  let start = events.length;
  while (start > 0 && events.length - start < 500) {
    const size = JSON.stringify(events[start - 1]).length * 2;
    if (bytes + size > 8 * 1024 * 1024) break;
    bytes += size;
    start--;
  }
  return events.slice(start);
}
