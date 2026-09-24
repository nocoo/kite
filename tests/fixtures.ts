export const event = (seq = 1) => ({
  schemaVersion: 1 as const,
  source: "future-source",
  name: "anything",
  producerId: "producer",
  seq,
  timestamp: 1,
  monotonicMs: 0.1,
  correlation: { sessionId: "s" },
  payload: { ok: true },
});
