"""Observe globally installed Kite with real Pi processes and an inert local provider."""
import concurrent.futures
import importlib.util
import json
import os
from pathlib import Path
import queue
import subprocess
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("probe", ROOT / "scripts/probe-pi-events.py")
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)


def observe(cwd, label):
    requests = 0

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def do_POST(self):
            nonlocal requests
            self.rfile.read(int(self.headers["Content-Length"]))
            requests += 1
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.end_headers()
            if requests == 1:
                pieces = [{"tool_calls": [
                    {"index": i, "id": f"call_{name}", "type": "function",
                     "function": {"name": "probe", "arguments": json.dumps({"label": name}) if name != "invalid" else "{}"}}
                    for i, name in enumerate(["slow", "fast", "blocked", "invalid"])
                ]}]
                finish = "tool_calls"
            else:
                pieces = [{"content": text} for text in ["Observed ", "parallel tools, ", "validation, ", "a blocked call, ", "and streaming. ", f"{label} complete."]]
                finish = "stop"
            for delta, reason in [(p, None) for p in pieces] + [({}, finish)]:
                time.sleep(0.6)
                chunk = {"id": f"local_{requests}", "object": "chat.completion.chunk", "created": int(time.time()),
                         "model": "offline", "choices": [{"index": 0, "delta": delta, "finish_reason": reason}]}
                self.wfile.write(("data: " + json.dumps(chunk) + "\n\n").encode())
                self.wfile.flush()
            self.wfile.write(b"data: [DONE]\n\n")

    with tempfile.TemporaryDirectory(prefix="kite-global-observe-") as temporary:
        directory = Path(temporary)
        extension = directory / "provider.ts"
        extension.write_text(probe.EXTENSION.replace('args.label === "slow" ? 30 : 1', 'args.label === "slow" ? 1800 : 400'))
        log = directory / "hooks.jsonl"
        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        environment = {**os.environ, "PI_TELEMETRY": "0", "KITE_PROBE_LOG": str(log),
                       "KITE_PROBE_URL": f"http://127.0.0.1:{server.server_port}/v1",
                       "NO_PROXY": "127.0.0.1,localhost", "no_proxy": "127.0.0.1,localhost"}
        environment.pop("PI_CODING_AGENT_DIR", None)
        environment.pop("KITE_PROBE_EXTENSION", None)
        command = ["pi", "--offline", "--mode", "rpc", "--no-session", "--no-skills", "--no-context-files",
                   "--no-prompt-templates", "--no-themes", "--extension", str(extension), "--approve",
                   "--provider", "kite-probe", "--model", "offline", "--tools", "probe"]
        incoming = queue.Queue()
        with (directory / "stderr.log").open("wb") as diagnostics:
            process = subprocess.Popen(command, cwd=cwd, env=environment, stdin=subprocess.PIPE,
                                       stdout=subprocess.PIPE, stderr=diagnostics)

            def read():
                for line in process.stdout:
                    try:
                        incoming.put(json.loads(line))
                    except json.JSONDecodeError:
                        continue
                incoming.put(None)

            threading.Thread(target=read, daemon=True).start()
            records = []
            try:
                process.stdin.write((json.dumps({"id": label, "type": "prompt", "message": f"Local Kite verification: {label}. Run the inert probe."}) + "\n").encode())
                process.stdin.flush()
                while True:
                    event = incoming.get(timeout=60)
                    assert event is not None, (directory / "stderr.log").read_text()
                    records.append(event)
                    if event["type"] == "extension_ui_request" and event.get("method") == "confirm":
                        time.sleep(1)
                        process.stdin.write((json.dumps({"type": "extension_ui_response", "id": event["id"], "confirmed": False}) + "\n").encode())
                        process.stdin.flush()
                    if event["type"] == "agent_settled":
                        break
                process.stdin.close()
                process.wait(timeout=15)
                assert process.returncode == 0, (directory / "stderr.log").read_text()
                assert not [e for e in records if e["type"] == "extension_error"], records
                assert any(e["type"] == "tool_execution_start" for e in records)
                return {"cwd": str(cwd), "label": label, "rpc_events": len(records), "provider_requests": requests,
                        "global_discovery": True, "explicit_extensions": ["inert local provider only"], "paid_requests": 0}
            finally:
                if process.poll() is None:
                    process.kill()
                    process.wait()
                server.shutdown()
                server.server_close()


if __name__ == "__main__":
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
        jobs = [executor.submit(observe, cwd, label) for cwd, label in [(ROOT, "Kite collector"), (ROOT.parent / "archy", "Architecture observer")]]
        print(json.dumps([job.result() for job in jobs], indent=2))
