# Changelog

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
