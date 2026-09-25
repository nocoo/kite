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
semantic surface/color tokens and reduced-motion support. Archy's relationship
diagrams and reference/pi-agent-observability's swimlanes informed the execution
map. Giraffe at `8c92d5a50df0b822dfd8b4227768d76aa107af23` is the application-shell
reference: a 260/68px Sidebar, 56px AppHeader, ancestor-only breadcrumbs, GitHub
and Hexly links, ThemeToggle last, and a single ContentIsland inside responsive
outer gutters. Basalt owns the header, island and PageHeader geometry. Giraffe's
local endpoint was unavailable during comparison; its checked-out components
and the installed Basalt sources supplied the reference.

`web/app-frame.tsx` owns responsive presentation, sidebar collapse and mobile
Sheet state. It composes public Basalt components and routes the overview
breadcrumb into the existing selection command. The mobile Sheet owns its focus
trap and scroll lock. Views use StatCard, Banner, LayerCard.Empty and Accordion
for metrics, notices, empty states and captured-payload disclosures. Business
visualizations retain their observed-event semantics and animation.

The approved transparent logo is used at 24px in both sidebar states, with a
48px high-density source and 16/32px PNG favicons. Artwork provenance and the
reproduction command are recorded in the [brand assets](../assets/brand/README.md).
`node scripts/browser-check.mjs` checks shell dimensions, fixed logo anchors,
breadcrumbs, header links, keyboard disclosure, drawer focus and scroll lock,
responsive transitions, both themes and the existing live/replay interactions.

## Bounded live and replay clocks

Live refresh requests the newest bounded page inside the recording filter, also
when reconnecting after a backlog. A gap in that visible window remains explicit;
full retained history is still accessible through From start. The browser does
not fetch a discarded backlog just to reach its end.

Replay fixes its upper cursor when opened. Recorded-time playback keeps a single
clock across pages and buffers the next page without exposing its first event
until its recorded time arrives. Step pacing deliberately advances observations
every 400ms at 1×. Seeking cancels both requests and buffered future pages.
