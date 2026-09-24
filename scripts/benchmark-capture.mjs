import { performance } from "node:perf_hooks";
import { Exporter } from "../dist/exporter.js";
import { attach } from "../dist/pi-extension.js";

async function sample(cumulativeBytes) {
  const handlers = new Map();
  let bytes = 0;
  const exporter = new Exporter("unused", 2048, 8 * 1024 * 1024, async (body) => {
    bytes += Buffer.byteLength(body);
    return { status: 200, body: { accepted: JSON.parse(body).length } };
  });
  attach({ on: (name, handler) => handlers.set(name, handler) }, () => exporter);
  handlers.get("session_start")({ type: "session_start" }, {});
  const message = { content: "x".repeat(cumulativeBytes), usage: { output: 1000 } };
  const event = {
    type: "message_update",
    message,
    assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "abc", partial: message },
  };
  const started = performance.now();
  for (let i = 0; i < 1000; i++) handlers.get("message_update")(event, {});
  const elapsed = performance.now() - started;
  await exporter.close(1000);
  return { elapsed, bytes, dropped: exporter.dropped };
}

const results = [];
for (const size of [1024, 1024 * 1024]) {
  const samples = [];
  for (let i = 0; i < 7; i++) samples.push(await sample(size));
  samples.sort((a, b) => a.elapsed - b.elapsed);
  const median = samples[3];
  results.push({
    cumulative_message_bytes: size,
    events: 1000,
    median_callback_ms: Number((median.elapsed / 1000).toFixed(4)),
    median_batch_bytes: median.bytes,
    dropped: median.dropped,
  });
}
console.log(
  JSON.stringify(
    { scope: "Callback capture and enqueue only; synthetic ACK, no disk or network", results },
    null,
    2,
  ),
);
