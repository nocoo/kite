# Kite

A local execution observatory for Pi. A passive extension captures public hooks;
a private SQLite collector retains seven days. The Basalt web app shows every
recording, its working directory, module flow, parallel tool attempts and original
event evidence. Replay each step or follow its recorded timing.

## Run locally

Requires Node.js 24+ with `node:sqlite` and Pi 0.87.1. Verified with Node 26.9.0.

```sh
npm ci --registry https://packagefeedproxy.microsoft.io/npm/
npm run build
node dist/cli.js serve
```

In another terminal, from this checkout:

```sh
pi install "$PWD"
npm run dev
```

The default directory is `~/.local/state/kite`; its database is `events.sqlite` and
its socket is `collector.sock`. For a different directory, start the collector
with `--dir /absolute/private/directory` and set
`KITE_SOCKET=/absolute/private/directory/collector.sock` when launching Pi.
Open **https://kite.dev.hexly.ai** (Caddy → 127.0.0.1:7055), then start `pi`
from any directory. Installation adds this checkout as a global Pi package; existing
packages are preserved. Existing Pi processes need `/reload` or a restart to load
the new extension. Remove it with `pi remove /absolute/path/to/kite`.

The overview separates recordings by source, Pi session ID and producer. Resuming
a Pi session creates another recording with the same session ID. Select a card
for its module map, timeline, payload inspector and tools. **From start** opens
history; **Live** follows new observations. The slider and previous/next controls
seek individual steps. Playback supports step pacing, recorded timing and
0.5–8× speed. Wall view hides navigation for a larger overview.

Raw replay pages contain at most 500 events / 4 MiB. Playback crosses segments;
previous/next segment controls retain access to every retained event. Segment
counts and projections describe that segment only, so earlier context can be
absent. Live memory is bounded by 500 events / approximately 8 MiB of serialized
UTF-16. Missing sequence positions, dropped-event notices and capture markers stay
visible. Quiet means no recent observation, not a dead process.

```sh
node dist/cli.js events --limit 100
node dist/cli.js events --after 100 --session SESSION_ID
node dist/cli.js export > trace.jsonl
```

`events` returns one JSON page. `export` follows durable cursors and writes JSONL.
Both accept `--dir`, `--after`, `--limit`, `--session` and `--source`.
Stop the collector with Ctrl+C. An existing socket is never automatically removed;
after an unclean exit, confirm the owning collector has stopped before removing
its stale socket.

## Captured data

The adapter registers all **39 released hooks** in Pi 0.87.1: session and resource
lifecycle, prompt/context preparation, provider request/response boundaries,
assistant text/thinking/tool-argument deltas, tool attempts/progress/results,
compaction, model settings, user prompts, and final settlement.

The schema preserves source event names, producer/sequence identity, wall and
monotonic timestamps, session/run/turn/message/tool/block correlation, and bounded
JSON payloads. It has no UI states. The collector accepts other sources and event
names without Pi-specific schema changes.

Callbacks enqueue snapshots without waiting for the collector. Delivery is best
effort with bounded memory, retries, transactional acknowledgements and duplicate
protection. Long outages and forced termination can lose records. Sequence gaps,
loss notices and truncation markers must remain visible to consumers.

**Traces contain private content**, including prompts, file paths, tool output and
provider-exposed thinking. Headers, credential-shaped fields and recognized binary
or image objects are filtered. Secrets embedded in ordinary text can remain.
Directories are private (0700); databases and sockets are 0600.

Extension-only capture does not expose exact SDK/RPC retry schedules, full queues,
arbitrary child sessions or another extension's internals. The unreleased
`provider_stream_event` hook is not registered. See the [collector contract](docs/collector.md)
and [source research](docs/research/pi-execution-visualization.md).

## Verify

```sh
npm run check
npm run build
python3 scripts/probe-collector.py
node scripts/benchmark-capture.mjs
python3 scripts/observe-local.py
node scripts/browser-check.mjs
```

`check` runs strict Biome, strict TypeScript and Vitest/V8 coverage. Statements,
branches, functions and lines each have a 95% floor across `src/**/*.ts` and `web/**/*.ts`.
React TSX files contain rendering/provider composition; the browser check verifies
those Views, including keyboard replay, mobile layout, themes, reduced motion,
loading/empty/error states and reconnects.
Husky runs these checks against a temporary Git-index snapshot before commits.

The integration probe owns a temporary collector and isolated Pi configuration,
using a local fake provider. It verifies retries, parallel/blocked/invalid tools,
durable restart, producer identity and successful Pi completion with the collector
offline. It makes no paid model calls. The benchmark measures callback capture and
enqueue cost with synthetic acknowledgements; it is not a disk/network benchmark.

The global observation script starts two real Pi processes from Kite and the
adjacent Archy checkout. It uses global extension discovery, an explicitly loaded
inert local provider, parallel tools and a blocked confirmation. The live collector
receives real hook events; no paid provider is called. Browser acceptance uses the
configured HTTPS domain and writes screenshots under ignored `.local/evidence/`.

The Vite bridge permits read-only requests from a local same-origin client. Caddy
restricts the Kite route to loopback addresses. No remote service receives traces.
See [interface architecture](docs/interface.md) for design and MVVM boundaries.
