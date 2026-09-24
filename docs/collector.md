# Local collector

Kite observes Pi through an extension and stores a local execution trace. Pi remains the interactive CLI. The collector does not send prompts, choose tools, change context, answer confirmations, or drive the agent.

## Data contract

The transport envelope describes facts: source, producer identity, sequence, capture time, session and execution correlation. The event name and JSON payload belong to the source. The collector accepts new event names without understanding Pi's lifecycle. There are no animation states, UI coordinates, or inferred reasoning stages in the stored schema.

Producer identity is independent of a durable Pi session ID. Reloads and separate processes can observe the same session; they must not reuse the same producer/sequence identity. A collector cursor orders committed storage records. It is not a causal clock across independent producers.

| Field | Meaning |
| --- | --- |
| `schemaVersion` | Envelope version, currently `1` |
| `source`, `name` | Source namespace and original event name; no lifecycle enum in storage |
| `producerId`, `seq` | Unique producer epoch and increasing positive sequence; the deduplication identity |
| `timestamp`, `monotonicMs` | Unix milliseconds and milliseconds since adapter initialization |
| `correlation` | Optional string/number map; Pi supplies session, model/provider, run, turn, message, tool and content-block identifiers when observed |
| `payload` | Source-owned JSON snapshot |
| `cursor`, `receivedAt` | Collector-assigned storage position and receipt time, present in query results |

Pi's `session_start` payload wraps the original event with CWD, session file, leaf ID, tested integration version and hook inventory. Synthetic `kite.delivery_loss` records report observed exporter loss when a subsequent hook can enqueue the notice. Neither the notice nor the shutdown tail is guaranteed to survive an outage. A producer continues its sequence across session switches; a newly loaded adapter gets a new producer ID.

Capturing a hook records what this extension observed at its position in Pi's handler chain. It does not prove that later handlers left the value unchanged. Tool execution-start means an attempt has begun, including validation and policy checks; agent-end does not mean automatic recovery has finished. Preserve those event names and interpret them only in a future consumer.

## Capture boundaries

Detailed local traces can contain user prompts, system instructions, thinking supplied by the provider, file paths, tool arguments, tool results and generated text. They are private application data, not an anonymized analytics feed. Credential-shaped fields and binary/image data are filtered, but a secret embedded in ordinary prose cannot be reliably recognized. Keep the storage directory private and review traces before sharing them.

Assistant streaming records contain deltas rather than repeated cumulative messages. Final messages remain authoritative. Oversized or unsupported data must carry explicit omission/truncation information. Serialized snapshots must not retain references that Pi can mutate later.

Snapshots use `_kiteOmitted`, `_kiteTruncated` and `_kiteBigInt` markers. A truncated string becomes `{ "text": "...", "_kiteTruncated": true }`; consumers must not assume every original string remains a string. Limits are 16 nesting levels, 4,096 visited nodes, 64 KiB per string and a 192 KiB traversal budget. Recognized image objects and binary buffers are omitted; all header maps and credential-shaped fields are redacted. Arbitrary prose remains unchanged within those limits.

The observer does not monkey-patch Pi or install global hooks. Extension-only capture cannot obtain the SDK/RPC-only retry countdown and full queue events. It also cannot see arbitrary child sessions or internal work inside another extension. The unreleased `provider_stream_event` event is not advertised as part of the Pi 0.87.1 contract.

## Delivery guarantees

Event callbacks enqueue bounded work and return without awaiting the collector. A separate exporter batches records over a local Unix socket. The collector acknowledges a batch after a database transaction commits. Retrying an acknowledged or uncertain batch must not create duplicate events; conflicting content under an existing identity is an error.

Delivery is best effort while Pi runs. Bounded memory means a long collector outage can lose events. Forced process termination can lose the unacknowledged tail. Sequence gaps, loss diagnostics and capture limits must remain visible to consumers; a trace is not implicitly complete because its last record exists.

Shutdown gets a bounded flush opportunity. Cleanup must terminate owned timers, requests and sockets. The collector never takes over an existing socket by blindly deleting it, and it does not expose a TCP listener.

The default queue holds at most 2,048 events and 8 MiB. Overflow prefers dropping queued streaming deltas, then the oldest event outside the in-flight batch. Batches contain at most 128 events and 1 MiB. Export starts after 25 ms; transient failures back off from 100 ms to a maximum of 5 seconds. Requests have a 1-second deadline; shutdown has a 250 ms flush budget. Permanent 4xx responses other than 429 discard that batch so later records can progress.

There is no producer-side disk spool. This keeps synchronous callback work bounded and avoids adding filesystem writes to Pi. SQLite is the durable boundary after a successful collector transaction. Retrying exactly the same encoded event is idempotent; a different encoding under the same identity conflicts, including changed key order.

## Local HTTP API

The HTTP server listens only on `collector.sock` inside the private storage directory.

| Request | Response |
| --- | --- |
| `GET /health` | `{ "ok": true, "schemaVersion": 1 }` |
| `POST /v1/events` | JSON event array; `{ "accepted": N, "inserted": M }` after commit; duplicates count as accepted |
| `GET /v1/events?after=0&limit=100` | `{ "events": [...] }` in ascending cursor order |

Queries accept `sessionId` and `source` filters. `limit` is 1–1,000; a page is also capped at approximately 4 MiB. Continue from the last returned cursor until an empty page, even if a page contains fewer rows than requested. Reading stops at the byte boundary without loading the rest of the selected rows. No cursor represents cross-producer causality.

POST requires `Content-Type: application/json`. Individual envelopes are limited to 256 KiB and batches to 1 MiB/128 events. Invalid input returns 400, conflicting identities 409, oversized requests 413 and unsupported media types 415. Unexpected storage failures return a generic 500 without paths or payloads. Data is stored in a WAL-mode SQLite database with `synchronous=FULL`.

## Verification scope

Unit tests exercise event validation, immutable and bounded capture, producer/session correlation, batching, retries, overflow, shutdown, transaction rollback, duplicate/conflicting identities, cursor queries and local HTTP boundaries. All production TypeScript belongs to the four-metric coverage scope. The research-only Python probe and generated build output are separate from that scope.

The commit gate exports the Git index into an owned temporary directory. It checks the staged source, tests and configuration, reuses installed dependencies and keeps generated coverage/cache output in that temporary tree. It does not re-stage, stash, fix or modify the development checkout. `npm run prepare` reproducibly activates Husky; the gate has a 120-second ceiling.

An isolated Pi acceptance probe complements UT: it runs a local fake provider with a transient failure, parallel tools, a blocked tool and an invalid tool. This checks the extension against the installed Pi runtime without paid model calls or personal provider configuration.

See [the research](research/pi-execution-visualization.md) for the version-specific event inventory and source evidence.
