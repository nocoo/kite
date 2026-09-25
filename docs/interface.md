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

The execution bridge keeps the fleet, runtime modules, correlated tool attempts
and replay ribbon in one bounded desktop viewport. Session slots retain their
order across refreshes; new recordings append and retention removes expired
ones. The running counter filters active recordings without disturbing their
positions. The fleet rail pages according to available height and can filter directory,
identity, model, provider or the latest observed module. Global module counts
represent the latest hook of each recording, not simultaneous work. A shutdown
therefore occupies Session, and a settled notification occupies Settle.
Selecting a recording loads its bounded event window into the same execution map.

The map fixes eight module positions and draws conceptual Pi routes with SVG.
Its nodes are Basalt Buttons; Basalt Flow is a linear step list and does not
represent branching, return paths or correlated tool attempts. This specialist
visualization is the only custom diagram surface. It uses Basalt chart colors,
stationary geometry, recent-signal highlights and dashed-path motion. Live
highlights expire 2.5 seconds after actual observations; replay uses the recorded
monotonic clock. Polling does not remount the map or restart an entrance animation.
Reduced-motion mode removes animation while retaining state and color.

Three tool slots show a bounded group of attempts. Follow displays the newest
group, manual paging pins a group, and All tools opens every observed attempt in
the segment. Stage markers illuminate only hooks actually received. A start is
an attempt, not proof that a tool body ran. Missing starts or ends leave duration
unknown. The right-side Basalt Sheet contains timeline filters, original payloads,
all tools, assistant text and provider-exposed thinking. Larger screens also show
a compact signal inspector beside the map. The main desktop canvas does not scroll;
evidence panels own their detail scroll. Narrow screens use a horizontal session
array; short screens retain document accessibility with island scrolling.

Replay preserves step seeking, recorded timing, speed selection and retained
segment traversal. No missing event is treated as successful completion. Silence
means observation is stale, not that a process is dead. `agent_end` remains
distinct from `agent_settled`. Sequence gaps, producer loss notices and payload
capture limits stay visible.

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
trap and scroll lock. Views use Banner, LayerCard, Tabs, Sheet and Accordion for notices, evidence,
empty states and captured-payload disclosures. The compact fleet telemetry is
rendered as text beside the visualization.

The approved transparent logo is used at 24px in both sidebar states, with a
48px high-density source and 16/32px PNG favicons. Artwork provenance and the
reproduction command are recorded in the [brand assets](../assets/brand/README.md).
`node scripts/browser-check.mjs` checks real local recordings, stable session and
node geometry, desktop viewport containment (1366–2560px), individual tool stages,
filters, replay, payload disclosure, drawer focus, both themes, offline recovery
and reduced motion. Screenshots and measurements are stored in `.local/evidence/`.

## Bounded live and replay clocks

Live refresh requests the newest bounded page inside the recording filter, also
when reconnecting after a backlog. A gap in that visible window remains explicit;
full retained history is still accessible through From start. The browser does
not fetch a discarded backlog just to reach its end.

Replay fixes its upper cursor when opened. Recorded-time playback keeps a single
clock across pages and buffers the next page without exposing its first event
until its recorded time arrives. Step pacing deliberately advances observations
every 400ms at 1×. Seeking cancels both requests and buffered future pages.
