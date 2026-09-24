import http.client
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import time


ROOT = Path(__file__).resolve().parent.parent


class LocalConnection(http.client.HTTPConnection):
    def __init__(self, path):
        super().__init__("localhost", timeout=3)
        self.path = str(path)

    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(self.timeout)
        self.sock.connect(self.path)


def request(path, route):
    connection = LocalConnection(path)
    try:
        connection.request("GET", route)
        response = connection.getresponse()
        body = json.loads(response.read())
        assert response.status == 200, (response.status, body)
        return body
    finally:
        connection.close()


def records(path):
    collected = []
    cursor = 0
    while True:
        page = request(path, f"/v1/events?after={cursor}&limit=100")
        batch = page["events"]
        if not batch:
            return collected
        collected.extend(batch)
        next_cursor = batch[-1]["cursor"]
        assert next_cursor > cursor
        cursor = next_cursor


def start(directory, diagnostics):
    process = subprocess.Popen(
        ["node", "dist/cli.js", "serve", "--dir", str(directory)],
        cwd=ROOT, stdout=diagnostics, stderr=diagnostics,
    )
    deadline = time.monotonic() + 10
    path = directory / "collector.sock"
    while time.monotonic() < deadline:
        assert process.poll() is None, "Collector exited during startup"
        try:
            request(path, "/health")
            return process, path
        except (OSError, http.client.HTTPException):
            time.sleep(0.02)
    process.terminate()
    process.wait(timeout=5)
    raise AssertionError("Collector did not become healthy")


def stop(process):
    if process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()


def pi_probe(path):
    started = time.monotonic()
    result = subprocess.run(
        ["python3", str(ROOT / "scripts/probe-pi-events.py")],
        cwd=ROOT,
        env={**os.environ, "KITE_SOCKET": str(path),
             "KITE_PROBE_EXTENSION": str(ROOT / "src/pi-extension.ts")},
        capture_output=True, text=True, timeout=60, check=True,
    )
    parsed = json.loads(result.stdout)
    assert parsed["checks"] == "passed"
    return parsed, time.monotonic() - started


def verify_trace(trace):
    assert trace, "Collector received no events"
    identities = [(e["producerId"], e["seq"]) for e in trace]
    assert len(identities) == len(set(identities))
    names = [e["name"] for e in trace]
    for name in ["session_start", "input", "before_agent_start", "context",
                 "context_with_system", "before_provider_request", "before_provider_headers",
                 "after_provider_response", "agent_start", "turn_start", "message_start",
                 "message_update", "message_end", "tool_execution_start", "tool_execution_update",
                 "tool_execution_end", "tool_result", "turn_end", "agent_end",
                 "agent_before_settle", "agent_settled", "session_shutdown"]:
        assert name in names, name
    assert names.count("agent_end") == 2
    assert names.count("agent_settled") == 1
    assert "provider_stream_event" not in names
    assert "auto_retry_start" not in names
    for event in trace:
        if event["name"] == "message_update":
            assert "message" not in event["payload"]
            assert "partial" not in event["payload"].get("assistantMessageEvent", {})
    for label in ["blocked", "invalid"]:
        matching = [e["name"] for e in trace
                    if e.get("correlation", {}).get("toolCallId") == f"call_{label}"]
        assert "tool_execution_start" in matching, matching
        assert "tool_execution_end" in matching, matching
        assert "tool_result" not in matching, matching
    encoded = json.dumps(trace)
    assert "local-dummy" not in encoded, "Provider credential leaked into telemetry"
    assert "Run the inert probe." in encoded
    assert "Done." in encoded


def main():
    with tempfile.TemporaryDirectory(prefix="kite-accept-", dir="/tmp") as temporary:
        directory = Path(temporary) / "state"
        with (Path(temporary) / "collector.log").open("wb") as diagnostics:
            process, path = start(directory, diagnostics)
            try:
                first, online_seconds = pi_probe(path)
                trace = records(path)
                verify_trace(trace)
                stop(process)
                process, path = start(directory, diagnostics)
                assert records(path) == trace, "Committed trace did not survive restart"
                second, _ = pi_probe(path)
                repeated = records(path)
                assert len(repeated) > len(trace)
                first_producers = {e["producerId"] for e in trace}
                next_producers = {e["producerId"] for e in repeated[len(trace):]}
                assert first_producers.isdisjoint(next_producers), "Producer identity reused"
                stop(process)
                offline, offline_seconds = pi_probe(path)
                assert first["http_requests"] == second["http_requests"] == offline["http_requests"] == 3
                print(json.dumps({
                    "checks": "passed", "pi_version": first["pi_version"],
                    "first_trace_records": len(trace), "total_records": len(repeated),
                    "event_names": sorted({e["name"] for e in trace}),
                    "online_seconds": round(online_seconds, 3),
                    "offline_seconds": round(offline_seconds, 3),
                    "restart_persistence": True, "distinct_producers": True,
                    "offline_pi_completed": True,
                }, indent=2))
            finally:
                stop(process)


if __name__ == "__main__":
    main()
