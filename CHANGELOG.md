# Changelog

## v0.1.1 — 2026-10-13

Patch dependency refresh and a collector query compatibility fix for Node.js 24
experimental `node:sqlite` (used when running tests on Node 24/26 in CI).

- Bump dev and runtime dependencies: `@types/node`, `@playwright/test`,
  `@vitejs/plugin-react`, `vite`, `lucide-react`, `vitest`, `@vitest/coverage-v8`.
- Pin transitive `source-map-js` to `1.2.2` (GHSA-68fv-2mgg-jv7q).
- Keep byte-bounded event pages on batched SQLite reads instead of per-row
  queries or full `LIMIT 1000` materialization after iterator lifetime issues
  surfaced under staged-index checks.

## v0.1.0 — 2026-09-25

First public source release of Kite, a local execution observatory for Pi.

- Observe all 39 released Pi v0.87.1 extension hooks through a passive, fail-open
  adapter, including session lifecycle, context preparation, streaming responses,
  tool attempts and final settlement.
- Persist source-neutral events and recording summaries in private local SQLite
  storage with seven-day retention, bounded snapshots, retry deduplication and
  explicit loss/truncation facts. Query or export traces through the CLI.
- Inspect multiple sessions, working directories and individual tools in an
  animated execution map. Use the fleet view, evidence drawers, module filters
  and raw payloads to follow observed activity.
- Replay retained history with step controls, recorded timing, adjustable speed
  and paged loading. Keep live observations distinct from replay state.
- Provide Basalt light/dark themes, consolidated live-session navigation,
  responsive controls, keyboard focus management and reduced-motion support.
- Derive sidebar, CLI and local liveness API versions from one package manifest.
  Add a documented release procedure and Node.js 24/26 CI with enforced coverage.
- Include bilingual setup documentation, a version-specific Pi hook inventory,
  unit tests, isolated fake-provider acceptance and browser verification scripts.

Installation uses the source checkout; this release does not publish an npm
package. See [installation](README.md#使用) or the [English guide](docs/README.en.md).
