import { isRecord } from "../src/schema.ts";
import type { SessionSummary, StoredEvent } from "../src/store.ts";

export const modules = [
  { id: "session", label: "Session", detail: "Identity, resources & configuration" },
  { id: "input", label: "Input", detail: "User input & prompt preparation" },
  { id: "context", label: "Context", detail: "Messages & system instructions" },
  { id: "provider", label: "Provider", detail: "Request, headers & response" },
  { id: "response", label: "Response", detail: "Exposed thinking & text chunks" },
  { id: "tools", label: "Tools", detail: "Attempts, checks & execution" },
  { id: "settle", label: "Settle", detail: "Run end & automatic completion" },
  { id: "compaction", label: "Compaction", detail: "Context reduction lifecycle" },
] as const;
export type ModuleId = (typeof modules)[number]["id"];
type EventInfo = { module: ModuleId; label: string; description: string };

const group = (module: ModuleId, rows: [string, string, string][]): Record<string, EventInfo> =>
  Object.fromEntries(rows.map(([name, label, description]) => [name, { module, label, description }]));

export const eventCatalog: Record<string, EventInfo> = {
  ...group("session", [
    ["project_trust", "Project trust", "Observer leaves the trust decision undecided."],
    ["resources_discover", "Discover resources", "Pi discovers extension-provided resources."],
    ["session_start", "Recording started", "Session identity and working directory are captured."],
    ["session_info_changed", "Session information", "Session metadata changed."],
    ["session_before_switch", "Before session switch", "A session switch was requested."],
    ["session_before_fork", "Before fork", "A session fork was requested."],
    ["session_before_tree", "Before tree navigation", "A conversation branch change was requested."],
    ["session_tree", "Tree navigation", "Pi navigated the conversation tree."],
    ["session_shutdown", "Recording closed", "The extension received a shutdown notification."],
    ["model_select", "Model selected", "The model selection changed."],
    ["thinking_level_select", "Thinking level", "The exposed thinking level setting changed."],
    ["kite.delivery_loss", "Delivery loss", "The producer reports events that could not be delivered."],
  ]),
  ...group("input", [
    ["input", "Input received", "Pi received input at this observer's handler position."],
    ["user_bash", "User shell command", "A user-initiated shell command was observed."],
    ["before_agent_start", "Prepare prompt", "Pi is preparing the prompt for an agent run."],
    ["agent_start", "Agent run started", "A new run begins; turn indices restart within this run."],
    ["ui_prompt_start", "Awaiting interaction", "Pi opened an interaction prompt."],
    ["ui_prompt_end", "Interaction ended", "The interaction prompt ended."],
  ]),
  ...group("context", [
    ["turn_start", "Turn started", "A turn begins inside the current agent run."],
    ["context", "Assemble context", "Conversation messages reached the context hook."],
    ["context_with_system", "Attach system context", "Context including system instructions was observed."],
  ]),
  ...group("provider", [
    ["before_provider_request", "Provider request", "Pi is about to send a provider request."],
    ["before_provider_headers", "Provider headers", "Request headers reached the hook; values are redacted."],
    ["after_provider_response", "Provider response", "The provider response reached the extension hook."],
    ["cache_warming_decision", "Cache warming", "Pi exposed a cache warming decision."],
  ]),
  ...group("response", [
    ["message_start", "Message started", "A user, assistant or tool-result message began."],
    ["message_update", "Response chunk", "A stream chunk was observed; chunks are not tokens."],
    ["message_end", "Message completed", "The final message is authoritative for content and usage."],
  ]),
  ...group("tools", [
    ["tool_execution_start", "Tool attempt", "An attempt begins before validation and tool-call handlers."],
    ["tool_call", "Tool-call check", "The call reached this observer; a later extension may still block it."],
    ["tool_execution_update", "Tool progress", "The tool emitted an execution update."],
    ["tool_result", "Tool result", "A tool result reached this observer's handler position."],
    [
      "tool_execution_end",
      "Tool attempt ended",
      "The attempt finished; inspect its result for errors or blocking.",
    ],
  ]),
  ...group("settle", [
    ["turn_end", "Turn ended", "The current turn ended; more turns may follow."],
    ["agent_end", "Agent run ended", "This low-level run ended; retries or further work may follow."],
    ["agent_before_settle", "Before settling", "Pi is checking whether automatic work has finished."],
    ["agent_settled", "Agent settled", "Pi reports the end of automatic work for this interaction."],
  ]),
  ...group("compaction", [
    ["session_before_compact", "Compaction started", "Pi is about to compact conversation context."],
    ["session_compact", "Compaction completed", "A compaction result was observed."],
    ["session_compact_failed", "Compaction failed", "Pi reported a compaction failure."],
  ]),
};

export function eventInfo(event: Pick<StoredEvent, "name" | "payload">): EventInfo {
  const info = (Object.hasOwn(eventCatalog, event.name) ? eventCatalog[event.name] : undefined) ?? {
    module: "session",
    label: event.name,
    description: "An unclassified observation is preserved as received.",
  };
  if (event.name !== "message_update") return info;
  const update = record(record(event.payload).assistantMessageEvent);
  return { ...info, label: typeof update.type === "string" ? update.type.replaceAll("_", " ") : info.label };
}

export function record(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}
export function textValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}
export function sessionKey(session: Pick<SessionSummary, "source" | "sessionId" | "producerId">): string {
  return JSON.stringify([session.source, session.sessionId, session.producerId]);
}
export function directoryName(cwd: string | null): string {
  return cwd?.split("/").filter(Boolean).at(-1) || "Unknown directory";
}
export function sessionStatus(session: SessionSummary, now: number): string {
  if (session.lastLifecycle === "session_shutdown") return "Closed";
  if (session.lastLifecycle === "agent_settled") return "Settled";
  if (now - session.lastSeen > 30_000) return "Quiet";
  if (session.lastActivity === "ui_prompt_start") return "Awaiting input";
  if (session.lastLifecycle === "agent_end") return "Between runs";
  if (session.lastLifecycle === "agent_start") return "Running";
  return "Observing";
}
export function duration(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`;
  return `${Math.floor(ms / 3_600_000)}h ${Math.floor((ms % 3_600_000) / 60_000)}m`;
}

export interface ToolAttempt {
  id: string;
  name: string;
  start?: number;
  end?: number;
  status: "attempt" | "checked" | "running" | "result" | "completed" | "error";
  cursor: number;
  detail: string;
  hooks: string[];
}
export interface Projection {
  hits: Record<ModuleId, number>;
  latest: Partial<Record<ModuleId, StoredEvent>>;
  active: ModuleId | null;
  status: string;
  tools: ToolAttempt[];
  runs: number;
  turns: number;
  chunks: number;
  tokens: number;
  loss: number;
  gaps: number;
  text: string;
  thinking: string;
  lastSeq: number;
  lastProducer: string;
}
export function emptyProjection(): Projection {
  return {
    hits: { session: 0, input: 0, context: 0, provider: 0, response: 0, tools: 0, settle: 0, compaction: 0 },
    latest: {},
    active: null,
    status: "Observing",
    tools: [],
    runs: 0,
    turns: 0,
    chunks: 0,
    tokens: 0,
    loss: 0,
    gaps: 0,
    text: "",
    thinking: "",
    lastSeq: 0,
    lastProducer: "",
  };
}

function contentText(content: unknown, type: string): string {
  return Array.isArray(content)
    ? content
        .filter((block) => record(block).type === type)
        .map((block) => {
          const value = record(block)[type];
          const captured = record(value);
          return captured._kiteTruncated === true
            ? `${textValue(captured.text)}\n[Capture truncated]`
            : textValue(value);
        })
        .join("")
        .slice(-32_768)
    : "";
}

export function applyEvent(state: Projection, event: StoredEvent): void {
  const payload = record(event.payload);
  const module = eventInfo(event).module;
  state.hits[module]++;
  state.latest[module] = event;
  state.active = module;
  if (state.lastProducer === event.producerId) state.gaps += Math.max(0, event.seq - state.lastSeq - 1);
  state.lastProducer = event.producerId;
  state.lastSeq = event.seq;
  if (event.name === "agent_start") {
    state.runs++;
    state.status = "Running";
  }
  if (event.name === "turn_start") state.turns++;
  if (event.name === "ui_prompt_start") state.status = "Awaiting input";
  if (event.name === "ui_prompt_end") state.status = "Observing";
  if (event.name === "agent_end") state.status = "Between runs";
  if (event.name === "agent_settled") {
    state.status = "Settled";
    state.active = null;
  }
  if (event.name === "session_shutdown") {
    state.status = "Closed";
    state.active = null;
  }
  if (event.name === "session_before_compact") state.status = "Compacting";
  if (event.name === "session_compact_failed") state.status = "Compaction failed";
  if (event.name === "session_compact") state.status = "Observing";
  if (event.name === "kite.delivery_loss" && typeof payload.dropped === "number")
    state.loss += payload.dropped;
  const message = record(payload.message);
  if (event.name === "message_start" && message.role === "assistant") {
    state.text = "";
    state.thinking = "";
  }
  if (event.name === "message_update") {
    state.chunks++;
    const update = record(payload.assistantMessageEvent);
    if (update.type === "text_delta") state.text = (state.text + textValue(update.delta)).slice(-32_768);
    if (update.type === "thinking_delta")
      state.thinking = (state.thinking + textValue(update.delta)).slice(-32_768);
  }
  if (event.name === "message_end" && message.role === "assistant") {
    state.text = contentText(message.content, "text");
    state.thinking = contentText(message.content, "thinking");
    const usage = record(message.usage);
    if (typeof usage.totalTokens === "number") state.tokens += usage.totalTokens;
  }
  if (module !== "tools") return;
  const callId = textValue(event.correlation?.toolCallId) || textValue(payload.toolCallId);
  if (!callId) return;
  const id = `${event.correlation?.runId ?? ""}:${callId}`;
  let tool = state.tools.find((item) => item.id === id);
  if (!tool) {
    tool = {
      id,
      name: textValue(event.correlation?.toolName) || textValue(payload.toolName) || "tool",
      start: event.name === "tool_execution_start" ? event.monotonicMs : undefined,
      status: "attempt",
      cursor: event.cursor,
      detail: "",
      hooks: [],
    };
    state.tools.push(tool);
  }
  if (event.name === "tool_call") tool.status = "checked";
  if (event.name === "tool_execution_update") tool.status = "running";
  if (event.name === "tool_result") tool.status = "result";
  if (event.name === "tool_execution_end") {
    tool.end = event.monotonicMs;
    tool.status = payload.isError === true ? "error" : "completed";
  }
  tool.cursor = event.cursor;
  if (!tool.hooks.includes(event.name)) tool.hooks.push(event.name);
  tool.detail = JSON.stringify(payload).slice(0, 4096);
}

export function project(events: readonly StoredEvent[], index = events.length - 1): Projection {
  const result = emptyProjection();
  for (let i = 0; i <= index && i < events.length; i++) applyEvent(result, events[i] as StoredEvent);
  return result;
}

export function replayTimes(events: readonly StoredEvent[], first = events[0]?.monotonicMs ?? 0): number[] {
  let time = 0;
  return events.map((event) => {
    time = Math.max(time, event.monotonicMs - first);
    return time;
  });
}
export function replayIndex(times: readonly number[], time: number): number {
  let low = 0,
    high = times.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if ((times[middle] as number) <= time) low = middle + 1;
    else high = middle;
  }
  return Math.max(0, low - 1);
}

export function filteredEvents(
  events: readonly StoredEvent[],
  module: ModuleId | "all",
  query: string,
): StoredEvent[] {
  const needle = query.trim().toLowerCase();
  return events.filter(
    (event) =>
      (module === "all" || eventInfo(event).module === module) &&
      (!needle || `${event.name} ${JSON.stringify(event.payload)}`.toLowerCase().includes(needle)),
  );
}

export function stableSessions(
  previous: readonly SessionSummary[],
  incoming: SessionSummary[],
): SessionSummary[] {
  const remaining = new Map(incoming.map((session) => [sessionKey(session), session]));
  const retained: SessionSummary[] = [];
  for (const session of previous) {
    const key = sessionKey(session);
    const updated = remaining.get(key);
    if (updated) retained.push(updated);
    remaining.delete(key);
  }
  return [...retained, ...[...remaining.values()].sort((a, b) => b.lastCursor - a.lastCursor)];
}

export function filteredSessions(
  sessions: readonly SessionSummary[],
  query: string,
  module: ModuleId | "all",
  runningAt: number | null = null,
) {
  const needle = query.trim().toLowerCase();
  return sessions.filter(
    (session) =>
      `${session.cwd} ${session.sessionId} ${session.producerId} ${session.model} ${session.provider}`
        .toLowerCase()
        .includes(needle) &&
      (module === "all" || eventInfo({ name: session.lastEvent, payload: null }).module === module) &&
      (runningAt === null || sessionStatus(session, runningAt) === "Running"),
  );
}

export function sessionGroups(sessions: readonly SessionSummary[], now: number) {
  const live: SessionSummary[] = [];
  const recordings: SessionSummary[] = [];
  for (const session of sessions) {
    (sessionStatus(session, now) === "Running" ? live : recordings).push(session);
  }
  return { live, recordings };
}

export function fleetSummary(sessions: readonly SessionSummary[], now: number) {
  const phases = emptyProjection().hits;
  const signals = new Set<ModuleId>();
  let running = 0,
    observations = 0,
    tools = 0,
    errors = 0;
  for (const session of sessions) {
    phases[eventInfo({ name: session.lastEvent, payload: null }).module]++;
    if (sessionStatus(session, now) === "Running") running++;
    observations += session.eventCount;
    tools += session.toolCount;
    errors += session.errorCount;
    if (now >= session.lastSeen && now - session.lastSeen <= 2500)
      signals.add(eventInfo({ name: session.lastEvent, payload: null }).module);
  }
  return { phases, running, observations, tools, errors, signals: [...signals] };
}

export function observedSignals(
  projection: Projection,
  clock: number,
  field: "timestamp" | "monotonicMs",
): ModuleId[] {
  return modules
    .filter((module) => {
      const event = projection.latest[module.id];
      return event !== undefined && clock >= event[field] && clock - event[field] <= 2500;
    })
    .map((module) => module.id);
}

export function toolWindow(tools: readonly ToolAttempt[], page: number | null) {
  const pages = Math.max(1, Math.ceil(tools.length / 3));
  const latest = tools.reduce(
    (last, tool, index) => (tool.cursor >= (tools[last]?.cursor ?? 0) ? index : last),
    0,
  );
  const index = page === null ? Math.floor(latest / 3) : Math.max(0, Math.min(page, pages - 1));
  const offset = page === null ? Math.min(index * 3, Math.max(0, tools.length - 3)) : index * 3;
  return { tools: tools.slice(offset, offset + 3), offset, page: index, pages };
}
