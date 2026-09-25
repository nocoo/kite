# Local execution observatory

Kite uses a passive Pi extension, a private SQLite collector and a Vite React
application. The browser accesses read-only same-origin endpoints through Vite;
the collector continues accepting writes only on its Unix socket. Caddy permits
loopback clients at `https://kite.dev.hexly.ai` (7055). Automated test ports are
17055 and 27055. Storage expires by collector receipt time after seven days.

## Model and view boundaries

The raw envelope remains source-neutral. Session summaries contain observed
facts, grouped by source, session and producer. A resumed Pi session keeps its
session ID and gets a separate recording. The application model maps released
Pi hooks to documented modules; unknown events remain visible. The ViewModel
owns polling, cancellation, selection, filters and replay. React views render
that state and send commands without owning network or lifecycle inference.

The overview shows all recordings, directory, latest activity and last-seen age.
Execution details combine a module map, parallel tool attempts, a step timeline
and original event evidence. Replay uses recorded timing within each recording;
step controls make adjacent observations independently inspectable. No missing
event is treated as successful completion. Silence means observation is stale,
not that a process is dead. An execution start is an attempt, not proof of a tool
body executing; `agent_end` is distinct from `agent_settled`.

## Design provenance

Basalt 2.1.8 was verified on the permitted npm registry. Authoritative checkout
read: `5dda9f82eb3c768a6b0d8723496ffd2ad5ce6af7`. Use published declarations and
the standalone CSS contract, React 19, public controls, a single ContentIsland,
semantic surface/color tokens and reduced-motion support. Archy's shell and
relationship diagrams and reference/pi-agent-observability's swimlanes informed
the composition. Kite's new logo is still under separate owner review, so this
application uses its name and a standard icon until accepted artwork is available.

## Bounded live and replay clocks

Live refresh requests the newest bounded page inside the recording filter, also
when reconnecting after a backlog. A gap in that visible window remains explicit;
full retained history is still accessible through From start. The browser does
not fetch a discarded backlog just to reach its end.

Replay fixes its upper cursor when opened. Recorded-time playback keeps a single
clock across pages and buffers the next page without exposing its first event
until its recorded time arrives. Step pacing deliberately advances observations
every 400ms at 1×. Seeking cancels both requests and buffered future pages.
