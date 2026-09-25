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

The execution bridge keeps runtime modules, correlated tool attempts and the
replay ribbon in one bounded desktop viewport. The Basalt sidebar is the single
session navigator: running recordings rise into Live, with stable order inside
each group. New recordings append and retention removes expired ones. Search
and live/module filters share the ViewModel with the main telemetry and diagram.
The sidebar can filter directory, identity, model, provider or the latest observed
module. Every retained recording is reachable through its own scroll region.
Global module counts
represent the latest hook of each recording, not simultaneous work. A shutdown
therefore occupies Session, and a settled notification occupies Settle.
Selecting a recording loads its bounded event window into the same execution map.

The map fixes eight module positions and draws conceptual Pi routes with SVG.
A vertical context spine feeds a central inference loop, with three wide tool
cards below. Provider and Response occupy the largest module cards; the loop
readout sits beside them. Its nodes are Basalt Buttons; Basalt Flow is a linear
step list and does not
represent branching, return paths or correlated tool attempts. This specialist
visualization is the only custom diagram surface. Directional SVG routes,
stationary geometry, recent-signal highlights and dashed-path motion show the
conceptual relationships without moving the cards. Live
highlights expire 2.5 seconds after actual observations; replay uses the recorded
monotonic clock. Polling does not remount the map or restart an entrance animation.
Reduced-motion mode removes animation while retaining state and color.
The diagram owns four semantic inks: cobalt for session/input/context, violet
for provider activity, teal for response/settling and copper for tools/compaction.
These derive from Basalt's blue chart swatch and purple/teal/orange accents, with
separate OKLCH lightness and chroma for each theme. Errors use Basalt danger.
Module fills are data-bearing marks: a theme-aware mix of the module ink and
Basalt bright, with solid icon tiles and an accent strip. Unobserved modules use
a neutral-dominant fill. Text, observed tracks and directional routes retain
measurable contrast. Current hooks have an explicit label and outline; recent
activity animates only the strip and route. Theme changes do not alter geometry.
The application aliases never replace shared Basalt surface or control tokens.
The surrounding LayerCard and its inspector Well retain the package's surface
stack; the specialist graph's colored marks are not general content wells.

Three tool slots show a bounded group of attempts. Follow keeps the most recently
observed tool in view, including updates from an earlier long-running attempt.
The range readout identifies the visible attempts; manual pages never overlap
and stay pinned when new attempts arrive. All tools opens every observed attempt
in the segment. Stage markers illuminate only hooks actually received. A start is
an attempt, not proof that a tool body ran. Missing starts or ends leave duration
unknown. The right-side Basalt Sheet contains timeline filters, original payloads,
all tools, assistant text and provider-exposed thinking. Larger screens also show
a compact signal inspector beside the map. The main desktop canvas does not scroll;
evidence panels own their detail scroll. Mobile and wall view open the same
session navigation in a left Sheet; the collapsed desktop rail retains session
shortcuts with identity tooltips. Live beacons animate only while the collector
is connected, and reduced motion replaces the halo animation with a static ring.
Short screens retain document accessibility with island scrolling.

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

`web/session-navigation.tsx` composes Basalt navigation, search and filter controls;
the model's session grouping keeps running priority separate from refresh order.
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
`node scripts/sidebar-check.mjs` uses browser-only fixtures to verify running
priority, focus across group changes, filtering, all-recording reachability,
collapsed shortcuts, offline beacons and wall-view navigation without writing
collector data.

`node scripts/visual-check.mjs` checks both palettes against real recordings:
overview, populated tool cards, hover and current-hook states, plus 320–1920px
layouts. It measures rendered text (4.5:1) and graphic (3:1) contrast against
composited backgrounds, checks visible card children for vertical clipping, and
captures settled screenshots in `.local/evidence/palette-*`.

## Bounded live and replay clocks

Live refresh requests the newest bounded page inside the recording filter, also
when reconnecting after a backlog. A gap in that visible window remains explicit;
full retained history is still accessible through From start. The browser does
not fetch a discarded backlog just to reach its end.

Replay fixes its upper cursor when opened. Recorded-time playback keeps a single
clock across pages and buffers the next page without exposing its first event
until its recorded time arrives. Step pacing deliberately advances observations
every 400ms at 1×. Seeking cancels both requests and buffered future pages.
