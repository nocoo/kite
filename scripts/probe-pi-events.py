import json
import os
from pathlib import Path
import queue
import subprocess
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


EXTENSION = r'''
import { appendFileSync } from "node:fs";

export default function (pi) {
  const record = (event) => appendFileSync(process.env.KITE_PROBE_LOG,
    JSON.stringify({ channel: "extension", ...event }) + "\n");
  for (const name of ["session_start", "input", "before_agent_start", "agent_start",
    "turn_start", "context", "context_with_system", "before_provider_request",
    "before_provider_headers", "after_provider_response", "provider_stream_event",
    "message_start", "message_update", "message_end", "tool_execution_start",
    "tool_call", "tool_execution_update", "tool_result", "tool_execution_end",
    "turn_end", "agent_end", "agent_before_settle", "agent_settled", "session_shutdown",
    "ui_prompt_start", "ui_prompt_end"]) {
    pi.on(name, (event) => {
      record({ type: name, toolCallId: event.toolCallId, role: event.message?.role,
        deltaType: event.assistantMessageEvent?.type, turnIndex: event.turnIndex,
        isError: event.isError, outcome: event.outcome });
    });
  }
  pi.on("tool_call", async (event, ctx) => {
    if (event.input.label === "blocked") {
      await ctx.ui.confirm("Probe confirmation", "This probe always blocks the inert tool.");
      return { block: true, reason: "Probe block" };
    }
  });
  pi.registerTool({
    name: "probe", label: "Probe", description: "An inert probe tool",
    parameters: { type: "object", properties: { label: { type: "string" } }, required: ["label"] },
    execute: async (id, args, _signal, onUpdate) => {
      record({ type: "probe_execute_enter", toolCallId: id });
      await new Promise(resolve => setTimeout(resolve, args.label === "slow" ? 30 : 1));
      onUpdate?.({ content: [{ type: "text", text: "progress" }], details: {} });
      record({ type: "probe_execute_exit", toolCallId: id });
      return { content: [{ type: "text", text: args.label }], details: {} };
    }
  });
  pi.registerProvider("kite-probe", {
    baseUrl: process.env.KITE_PROBE_URL, apiKey: "local-dummy", api: "openai-completions",
    models: [{ id: "offline", name: "Offline", reasoning: false, input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32000, maxTokens: 1024 }]
  });
}
'''


def run_probe():
    request_count = 0

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def do_POST(self):
            nonlocal request_count
            self.rfile.read(int(self.headers["Content-Length"]))
            request_count += 1
            if request_count == 1:
                body = b'{"error":{"message":"503 overloaded probe","type":"server_error"}}'
                self.send_response(503)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.end_headers()
            calls = [
                {"index": index, "id": f"call_{label}", "type": "function",
                 "function": {"name": "probe", "arguments": json.dumps({"label": label})}}
                for index, label in enumerate(["slow", "fast", "blocked"])
            ]
            calls.append({"index": 3, "id": "call_invalid", "type": "function",
                          "function": {"name": "probe", "arguments": '{}'}})
            delta = {"tool_calls": calls} if request_count == 2 else {"content": "Done."}
            finish = "tool_calls" if request_count == 2 else "stop"
            for value, reason in [(delta, None), ({}, finish)]:
                chunk = {"id": f"completion_{request_count}", "object": "chat.completion.chunk",
                         "created": 0, "model": "offline",
                         "choices": [{"index": 0, "delta": value, "finish_reason": reason}]}
                self.wfile.write(("data: " + json.dumps(chunk) + "\n\n").encode())
                self.wfile.flush()
            self.wfile.write(b"data: [DONE]\n\n")

    with tempfile.TemporaryDirectory(prefix="kite-pi-probe-") as temporary:
        directory = Path(temporary)
        extension_path = directory / "probe.ts"
        extension_path.write_text(EXTENSION)
        log_path = directory / "extension.jsonl"
        (directory / "settings.json").write_text(json.dumps({
            "enableAnalytics": False, "enableInstallTelemetry": False, "cacheWarming": "off",
            "compaction": {"enabled": False},
            "retry": {"enabled": True, "maxRetries": 1, "baseDelayMs": 10,
                      "provider": {"maxRetries": 0}},
        }))
        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        environment = {**os.environ, "PI_CODING_AGENT_DIR": temporary,
                       "PI_TELEMETRY": "0", "KITE_PROBE_LOG": str(log_path),
                       "KITE_PROBE_URL": f"http://127.0.0.1:{server.server_port}/v1",
                       "NO_PROXY": "127.0.0.1,localhost", "no_proxy": "127.0.0.1,localhost"}
        command = ["pi", "--mode", "rpc", "--no-session", "--no-extensions", "--no-skills",
                   "--no-prompt-templates", "--no-themes", "--extension", str(extension_path),
                   "--provider", "kite-probe", "--model", "offline", "--tools", "probe"]
        if observer := os.environ.get("KITE_PROBE_EXTENSION"):
            command.extend(["--extension", str(Path(observer).resolve())])
        records = []
        incoming = queue.Queue()
        with (directory / "stderr.log").open("wb") as diagnostics:
            process = subprocess.Popen(command, cwd=temporary, env=environment,
                                       stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=diagnostics)

            def read_records():
                for line in process.stdout:
                    incoming.put(json.loads(line))
                incoming.put(None)

            threading.Thread(target=read_records, daemon=True).start()
            try:
                process.stdin.write(b'{"id":"probe","type":"prompt","message":"Run the inert probe."}\n')
                process.stdin.flush()
                while True:
                    event = incoming.get(timeout=45)
                    assert event is not None, (directory / "stderr.log").read_text()
                    records.append(event)
                    if event["type"] == "extension_ui_request" and event.get("method") == "confirm":
                        process.stdin.write((json.dumps({"type": "extension_ui_response",
                                                        "id": event["id"], "confirmed": False}) + "\n").encode())
                        process.stdin.flush()
                    if event["type"] == "agent_settled":
                        break
                process.stdin.close()
                process.wait(timeout=10)
                assert process.returncode == 0, (directory / "stderr.log").read_text()
            finally:
                if process.poll() is None:
                    process.kill()
                    process.wait()
                server.shutdown()
                server.server_close()
        extension = [json.loads(line) for line in log_path.read_text().splitlines()]
        types = [event["type"] for event in records]
        assert request_count == 3, request_count
        assert types.count("agent_end") == 2 and types.count("agent_settled") == 1, types
        assert "auto_retry_start" in types and "auto_retry_end" in types
        for label in ["blocked", "invalid"]:
            events = [e["type"] for e in extension if e.get("toolCallId") == f"call_{label}"]
            assert "tool_execution_start" in events and "tool_execution_end" in events, events
            assert "probe_execute_enter" not in events and "tool_result" not in events, events
        invalid = [e["type"] for e in extension if e.get("toolCallId") == "call_invalid"]
        assert "tool_call" not in invalid, invalid
        slow = [e["type"] for e in extension if e.get("toolCallId") == "call_slow"]
        assert slow.index("tool_execution_start") < slow.index("tool_call") < slow.index("probe_execute_enter")
        positions = {(e["type"], e.get("toolCallId")): i for i, e in enumerate(extension)}
        assert positions["probe_execute_enter", "call_fast"] < positions["probe_execute_exit", "call_slow"]
        assert positions["tool_execution_end", "call_fast"] < positions["tool_execution_end", "call_slow"]
        for name in ["before_provider_request", "before_provider_headers", "after_provider_response",
                     "context_with_system", "ui_prompt_start", "ui_prompt_end"]:
            assert any(e["type"] == name for e in extension), name
        assert not any(e["type"] == "provider_stream_event" for e in extension)
        assert not any(e["type"] in {"before_provider_request", "provider_stream_event"} for e in records)
        result = {"pi_version": subprocess.check_output(["pi", "--version"], text=True).strip(),
                  "http_requests": request_count, "checks": "passed",
                  "provider_stream_event_observed": False, "extension": extension,
                  "rpc": [{"channel": "rpc", "type": e["type"],
                           **{key: e[key] for key in ["toolCallId", "isError", "willRetry", "attempt"] if key in e}}
                          for e in records]}
        print(json.dumps(result, indent=2))


if __name__ == "__main__":
    run_probe()
