# Kite

Kite is a local execution-trace collector. A passive Pi extension produces events;
a separate process persists them for future visualization. There is no UI yet.

## Boundaries

- Keep the collector schema source-neutral. Store original event names and facts;
  do not bake animation states or interpretations of Pi's lifecycle into storage.
- Keep Pi callbacks fail-open. Capture must not modify an event, return a control
  decision, add conversation entries, or wait for collector availability.
  `project_trust` is the Pi API exception: return `{ trusted: "undecided" }`.
- Register hooks in the extension factory; open resources only at `session_start`.
  Bound the shutdown flush and release owned requests, timers and sockets.
- Use immutable, bounded snapshots. Stream deltas must not copy cumulative
  assistant messages. Preserve final messages and explicit loss/truncation facts.
- Keep runtime storage private and local. Traces can include prompts, source code,
  tool output and provider-exposed thinking; field redaction cannot sanitize prose.
- Do not install the extension globally, invoke paid providers, publish, or change
  the UI as a side effect of collector work.

## Evidence

The released integration baseline is Pi 0.87.1. The upstream development checkout
contains unreleased hooks; confirm the release tag before changing the contract.
See `docs/research/pi-execution-visualization.md` for source evidence and limits.

Production TypeScript must remain inside the UT coverage scope, with statements,
branches, functions and lines each at least 95%. Test persistence, retries, loss,
correlation and no-influence behavior, not just serialization happy paths.
The Python probes use an isolated Pi configuration and a local fake provider.
They complement UT and do not claim TypeScript coverage for subprocesses.

Commands: `npm run check` runs check-only lint, strict types and UT with enforced
coverage; `npm run build` compiles the Node CLI; `python3 scripts/probe-collector.py`
runs isolated Pi acceptance after a build. `node scripts/benchmark-capture.mjs`
measures callback/enqueue work with synthetic acknowledgements.

`npm run prepare` installs the Husky launcher. `.husky/pre-commit` delegates to
`scripts/check-index.mjs`, which checks the staged snapshot with a 120-second
timeout. Keep the ordinary gate below 30 seconds; do not add caching or bypasses.

`reference/` contains ignored upstream clones. Do not modify them or commit their
contents. L1 audit reports belong in nmem, not in tracked repository reports.
