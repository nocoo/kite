const now = Date.now();

export const isolatedSession = {
  source: "browser-fixture",
  sessionId: "isolated-session",
  producerId: "kite-probe",
  firstCursor: 1,
  lastCursor: 19,
  firstSeen: now - 60_000,
  lastSeen: now,
  eventCount: 19,
  cwd: "/workspace/kite",
  model: "offline",
  provider: "kite-probe",
  lastEvent: "session_shutdown",
  lastLifecycle: "session_shutdown",
  lastActivity: "tool_execution_end",
  toolCount: 3,
  errorCount: 0,
  lossCount: 0,
};

const event = (seq, name, extra = {}) => ({
  cursor: seq,
  receivedAt: now,
  schemaVersion: 1,
  source: isolatedSession.source,
  name,
  producerId: isolatedSession.producerId,
  seq,
  timestamp: now,
  monotonicMs: seq * 100,
  correlation: {
    sessionId: isolatedSession.sessionId,
    provider: isolatedSession.provider,
    model: isolatedSession.model,
    ...extra.correlation,
  },
  payload: extra.payload ?? {},
});

export const isolatedEvents = [
  event(1, "session_start", { payload: { cwd: isolatedSession.cwd } }),
  event(2, "input", { payload: { text: "inspect probe" } }),
  event(3, "before_agent_start"),
  event(4, "context"),
  event(5, "before_provider_request"),
  event(6, "after_provider_response"),
  event(7, "message_start", { payload: { message: { role: "assistant" } } }),
  event(8, "message_update", {
    payload: {
      assistantMessageEvent: { type: "thinking_delta", delta: "isolated thinking" },
    },
  }),
  event(9, "message_end", {
    payload: {
      message: {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "isolated thinking" },
          { type: "text", text: "isolated answer" },
        ],
        usage: { totalTokens: 4 },
      },
    },
  }),
  event(10, "tool_execution_start", {
    correlation: { toolCallId: "probe", toolName: "probe" },
    payload: { toolCallId: "probe", toolName: "probe" },
  }),
  event(11, "tool_execution_update", {
    correlation: { toolCallId: "probe", toolName: "probe" },
    payload: { toolCallId: "probe", toolName: "probe" },
  }),
  event(12, "tool_execution_end", {
    correlation: { toolCallId: "probe", toolName: "probe" },
    payload: { toolCallId: "probe", toolName: "probe", isError: false },
  }),
  ...["probe-b", "probe-c"].flatMap((id, index) => {
    const start = 13 + index * 3;
    return [
      event(start, "tool_execution_start", {
        correlation: { toolCallId: id, toolName: id },
        payload: { toolCallId: id, toolName: id },
      }),
      event(start + 1, "tool_execution_update", {
        correlation: { toolCallId: id, toolName: id },
        payload: { toolCallId: id, toolName: id },
      }),
      event(start + 2, "tool_execution_end", {
        correlation: { toolCallId: id, toolName: id },
        payload: { toolCallId: id, toolName: id, isError: false },
      }),
    ];
  }),
  event(19, "session_shutdown"),
];

export async function installIsolatedRoutes(page) {
  await page.route("**/api/sessions?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ sessions: [isolatedSession], nextBefore: null, retentionDays: 7 }),
    }),
  );
  await page.route("**/api/events?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ events: isolatedEvents }),
    }),
  );
}
