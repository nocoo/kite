<p align="center">
  <img src="../assets/brand/icon-rounded.png" width="128" alt="Kite logo" />
</p>
<h1 align="center">Kite</h1>
<p align="center">Observe Pi locally, follow multiple sessions, and replay each execution step.</p>
<p align="center"><a href="../README.md">简体中文</a></p>

## What it does

Kite is a local execution observatory for Pi users, built from a passive extension, a SQLite collector, and a web interface. You continue working in the Pi CLI; Kite receives public hook notifications and presents sessions, context preparation, model responses, and tool execution in one place.

The extension does not send prompts, choose tools, modify context, or answer confirmations. Its capture format preserves original events and correlation without embedding UI state; other sources can use the same storage protocol. Data stays on the local machine and is not sent to a remote service.

## Features

- **Multiple sessions**: distinguish recordings by source, Pi session, and recording instance; see working directories, models, latest stages, and activity times. Wall view hides navigation for an overview of all sessions.
- **Execution visualization**: eight modules show session, input, context, compaction, provider, response, tools, and settlement, with highlights and animation driven by observed events.
- **Detailed inspection**: a timeline, module filters, content search, original event payloads, parallel tool attempts, and text/thinking fragments exposed by the provider.
- **History replay**: SQLite retains seven days by receipt time, with step pacing, recorded intervals, 0.5–8× speed, and playback across segments.
- **Passive capture**: registers all 39 released extension hooks in Pi 0.87.1. Callbacks enqueue without waiting for the collector; batching, retries, and deduplication run separately.
- **Local interface**: Basalt light/dark themes, mobile layouts, keyboard seeking, and reduced-motion preferences.

The interface presents events actually observed by the extension. A tool start is an attempt: validation or policy can still prevent execution. `agent_end` is distinct from final `agent_settled`. A lack of recent events does not establish that a process has exited.

## Usage

### Install and start

Requires Node.js 24+ with `node:sqlite` and an installed Pi 0.87.1. Currently verified on macOS with Node.js 26.9.0; the collector uses a Unix domain socket and needs an environment that supports it.

```sh
git clone https://github.com/nocoo/kite.git
cd kite
npm ci --registry https://packagefeedproxy.microsoft.io/npm/
npm run build
pi install "$PWD"
```

Start the collector from the repository and leave the terminal running:

```sh
npm start
```

In another terminal, start the web interface from the same repository:

```sh
npm run dev
```

Open <http://127.0.0.1:7055>, then start `pi` from any working directory. Installation adds this checkout to Pi's global extension packages and preserves existing packages. Already-running Pi processes need `/reload` or a restart.

A local development environment with Caddy configured can also use <https://kite.dev.hexly.ai>. This domain points to the local machine; it is not a publicly hosted service. Source installation does not configure DNS, TLS, or Caddy automatically.

### Observe and replay

Select a session card to inspect its module map, event timeline, tools, and original payloads. **From start** opens the beginning of retained history; **Live** follows new observations. The slider and previous/next buttons seek individual steps, while timing and speed controls set playback pacing. Resuming the same Pi session creates a new recording instance.

Each history segment contains at most 500 events and 4 MiB. Replay traverses segments; counts and projections describe only the current segment. The live window retains at most 500 events and approximately 8 MiB of serialized UTF-16 data; earlier context remains accessible through history. Sequence gaps, loss notices, and truncation markers stay visible.

### Storage and CLI

The default data directory is `~/.local/state/kite`, containing the `events.sqlite` database and `collector.sock` communication socket.

```sh
node dist/cli.js --version
node dist/cli.js events --limit 100
node dist/cli.js events --after 100 --session SESSION_ID
node dist/cli.js export > trace.jsonl
```

`events` returns one JSON page; `export` follows storage cursors and writes JSONL. Both accept `--dir`, `--after`, `--limit`, `--session`, and `--source`.

Stop the collector with Ctrl+C. It never automatically removes an existing socket. After an unclean exit, confirm that the owning collector has stopped before removing its stale socket. Remove the global extension with `pi remove /absolute/path/to/kite`.

**Traces can contain private content**: prompts, paths, source code, tool output, and thinking exposed by the provider. Headers, credential-shaped fields, and recognized binary/image objects are filtered; secrets embedded in ordinary prose can remain. Directories use `0700`, while databases and sockets use `0600`. Review trace contents before sharing them.

Delivery is best effort. Long outages, queue overflow, or forced termination can lose events. The extension cannot observe complete SDK/RPC retry schedules, full queue state, arbitrary child sessions, or another extension's internal work. The unreleased `provider_stream_event` is outside the Pi 0.87.1 capture contract.

## Development

Follow the installation steps above. Common commands:

```sh
npm run dev
npm run build
npm run preview
```

`dev` and `preview` both bind to `127.0.0.1:7055` and cannot run simultaneously. Preview serves the build output; both require a separately running collector. Vite's read-only same-origin API accesses the Unix socket; the browser cannot write events through that API.

For a different storage directory, pass `--dir` to the collector and set the same `KITE_SOCKET` for both Pi and Vite. Run each of these three commands in a separate terminal:

```sh
node dist/cli.js serve --dir /absolute/private/directory
KITE_SOCKET=/absolute/private/directory/collector.sock npm run dev
KITE_SOCKET=/absolute/private/directory/collector.sock pi
```

Pass the corresponding `--dir` when querying the custom directory through the CLI. The preview server also selects its collector through `KITE_SOCKET`.

| Path | Responsibility |
| --- | --- |
| `src/` | Extension adapter, capture/transport, SQLite, CLI, and read-only web API |
| `web/model.ts` | Maps events into observed modules and state |
| `web/view-model.ts` | Polling, selection, cancellation, filtering, and replay |
| `web/App.tsx` | Basalt views and interaction bindings |
| `tests/`, `scripts/` | Unit tests, real Pi probes, browser acceptance, and capture benchmarks |

## Tests

After installing dependencies, run static checks and unit tests:

```sh
npm run check
```

`check` runs Biome, TypeScript, and Vitest/V8. Unit tests verify the collector, Model, and ViewModel; browser acceptance separately verifies React views.

Real Pi integration checks need Python 3, Pi 0.87.1, and a built CLI:

```sh
npm run build
python3 scripts/probe-collector.py
node scripts/benchmark-capture.mjs
```

The probe uses a temporary collector, isolated Pi configuration, and a local test provider to check retries, parallel/blocked/invalid tools, restart persistence, and Pi completion while the collector is offline. It makes no paid model calls. The benchmark measures callback capture and enqueue work with synthetic acknowledgements, not disk or network throughput.

Global-extension and browser acceptance require a running collector and web interface, a globally installed Kite extension, an adjacent `../archy` working directory, local Google Chrome, and a working `https://kite.dev.hexly.ai` development mapping:

```sh
python3 scripts/observe-local.py
node scripts/browser-check.mjs
```

Run observation first: it starts two real Pi processes through global extension discovery and uses a local test provider to create replayable traces. Then run browser acceptance, which checks session/directory identity, replay, filtering, themes, wall view, reconnects, loading/empty states, mobile layouts, and reduced motion. Screenshots go to the ignored `.local/evidence/` directory.

## Stack

| Technology | Role |
| --- | --- |
| TypeScript, Node.js | Pi extension, collector service, CLI, and shared types |
| SQLite (`node:sqlite`) | Local events, recording summaries, and seven-day history |
| React, Vite | Web rendering, local development, and same-origin API bridge |
| Basalt, Lucide | UI components, themes, design tokens, and icons |
| Vitest, Playwright | Logic unit tests and real browser acceptance |

## Documentation

- [Versioning and releases](releases.md)
- [Changelog](../CHANGELOG.md)
- [Capture protocol, boundaries, and delivery guarantees](collector.md)
- [Interface architecture, MVVM, and replay design](interface.md)
- [Pi extension hook research and source evidence](research/pi-execution-visualization.md)
- [Brand assets and provenance](../assets/brand/README.md)

## License

The code is licensed under the [MIT License](../LICENSE). See the [brand notes](../assets/brand/README.md) for generated artwork provenance and usage.
