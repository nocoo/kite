# Kite

Kite is a local execution observatory. A passive Pi extension produces neutral
events; a separate collector persists seven days in SQLite. A Vite/React Basalt
web app displays multiple recordings and replays observed steps using MVVM.

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
- Global local-path Pi installation and the Vite UI are authorized. Keep the
  observer passive; do not invoke paid providers or publish as an acceptance
  side effect. Use the local fake provider for reproducible Pi observation.
- The browser reads through the Vite same-origin bridge on 127.0.0.1:7055. Use
  https://kite.dev.hexly.ai for local manual acceptance; 17055/27055 are test ports.
- Keep application logic in web/model.ts and web/view-model.ts, measured by UT.
  TSX files are rendering/provider composition, verified with browser checks.
  Basalt 2.1.8 standalone CSS is the sole design/CSS contract.

## Evidence

The released integration baseline is Pi 0.87.1. The upstream development checkout
contains unreleased hooks; confirm the release tag before changing the contract.
See `docs/research/pi-execution-visualization.md` for source evidence and limits.

Collector, model and ViewModel TypeScript must remain inside the UT coverage scope, with statements,
branches, functions and lines each at least 95%. Test persistence, retries, loss,
correlation and no-influence behavior, not just serialization happy paths.
The Python probes use an isolated Pi configuration and a local fake provider.
They complement UT and do not claim TypeScript coverage for subprocesses.

Commands: `npm run check` runs check-only lint, strict types and UT with enforced
coverage; `npm run build` compiles the Node CLI and Vite web app; `python3 scripts/probe-collector.py`
runs isolated Pi acceptance after a build. `node scripts/benchmark-capture.mjs`
measures callback/enqueue work with synthetic acknowledgements.

`npm run prepare` installs the Husky launcher. `.husky/pre-commit` delegates to
`scripts/check-index.mjs`, which checks the staged snapshot with a 120-second
timeout. Keep the ordinary gate below 30 seconds; do not add caching or bypasses.

`reference/` contains ignored upstream clones. Do not modify them or commit their
contents. L1 audit reports belong in nmem, not in tracked repository reports.

## Releases

Root `package.json` is the single version source; npm synchronizes
`package-lock.json`. Keep UI/CLI versions and `/api/live` derived from it.
Use `docs/releases.md` and the maintained `system0-github-versioning` procedure.
GitHub `CI` must pass for the exact release commit on Node.js 24 and 26.
This is a private npm package distributed through GitHub source releases;
local installation does not imply npm publication or a hosted deployment.
