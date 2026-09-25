import {
  Badge,
  Button,
  DialogDescription,
  DialogTitle,
  Input,
  LayerCard,
  ThemeToggle,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@nocoo/basalt";
import { AppHeader } from "@nocoo/basalt/components/app-header";
import { AppMain, AppShell, AppSkipLink } from "@nocoo/basalt/components/app-shell";
import { PageHeader } from "@nocoo/basalt/components/page-header";
import { SectionRule } from "@nocoo/basalt/components/section-rule";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nocoo/basalt/components/select";
import {
  ContentIsland,
  Sidebar,
  SidebarFooter,
  SidebarHeader,
  SidebarIconItem,
  SidebarItem,
  SidebarNav,
  SidebarPartition,
  SidebarProvider,
} from "@nocoo/basalt/components/sidebar";
import { Slider } from "@nocoo/basalt/components/slider";
import {
  Activity,
  ArrowDownLeft,
  ArrowLeft,
  ArrowRight,
  AudioLines,
  Blocks,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  Clock3,
  Database,
  Feather,
  FileText,
  Folder,
  GitBranch,
  Globe2,
  Layers3,
  Maximize2,
  Menu,
  Network,
  Pause,
  Play,
  Radio,
  RefreshCw,
  ScanLine,
  Search,
  ShieldCheck,
  SkipBack,
  SkipForward,
  Terminal,
  TriangleAlert,
  Workflow,
  X,
} from "lucide-react";
import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import packageInfo from "../package.json" with { type: "json" };
import type { SessionSummary, StoredEvent } from "../src/store.ts";
import {
  directoryName,
  duration,
  eventInfo,
  filteredEvents,
  type ModuleId,
  modules,
  type Projection,
  project,
  sessionKey,
  sessionStatus,
} from "./model.ts";
import type { Observatory, ObservatoryState } from "./view-model.ts";

const icons = {
  session: Layers3,
  input: Terminal,
  context: Blocks,
  provider: Globe2,
  response: AudioLines,
  tools: Workflow,
  settle: Check,
  compaction: Database,
};

function IconButton({
  label,
  children,
  ...props
}: { label: string; children: ReactNode } & React.ComponentProps<typeof Button>) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={label} {...props}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function App({ vm }: { vm: Observatory }) {
  const state = useSyncExternalStore(vm.subscribe, vm.getSnapshot);
  const selectedKey = state.selected ? sessionKey(state.selected) : "";
  const previousKey = useRef(selectedKey);
  useLayoutEffect(() => {
    if (previousKey.current === selectedKey) return;
    previousKey.current = selectedKey;
    document.getElementById("observatory-content")?.scrollTo({ top: 0, left: 0, behavior: "instant" });
    document.getElementById("main-content")?.focus({ preventScroll: true });
  }, [selectedKey]);
  const [compact, setCompact] = useState(() => matchMedia("(max-width: 767px)").matches);
  const [collapsed, setCollapsed] = useState(() => matchMedia("(max-width: 767px)").matches);
  const [wall, setWall] = useState(false);
  useEffect(() => {
    vm.start();
    return () => vm.stop();
  }, [vm]);
  useEffect(() => {
    const query = matchMedia("(max-width: 767px)");
    const change = () => {
      setCompact(query.matches);
      setCollapsed(query.matches);
    };
    query.addEventListener("change", change);
    return () => query.removeEventListener("change", change);
  }, []);
  const choose = (session: SessionSummary | null) => {
    void vm.select(session);
    if (compact) setCollapsed(true);
  };
  return (
    <SidebarProvider
      collapsed={wall || collapsed}
      onCollapsedChange={setCollapsed}
      overlay={compact}
      defaultWidth={224}
    >
      <AppShell className={`kite-shell ${wall ? "wall-mode" : ""}`}>
        <AppSkipLink href="#main-content">Skip to observatory</AppSkipLink>
        <Sidebar className="kite-sidebar">
          {compact && (
            <>
              <DialogTitle className="sr-only">Kite navigation</DialogTitle>
              <DialogDescription className="sr-only">
                Choose the overview or a Pi recording.
              </DialogDescription>
            </>
          )}
          <SidebarHeader>
            <div className="brand">
              <span className="brand-mark">
                <Feather />
              </span>
              {!(collapsed || wall) && (
                <>
                  <strong>Kite</strong>
                  <span className="version">{packageInfo.version}</span>
                </>
              )}
            </div>
          </SidebarHeader>
          <SidebarNav aria-label="Observatory navigation">
            {collapsed || wall ? (
              <SidebarIconItem
                aria-label="All sessions"
                active={!state.selected}
                onClick={() => choose(null)}
              >
                <Network />
              </SidebarIconItem>
            ) : (
              <SidebarItem active={!state.selected} onClick={() => choose(null)}>
                <Network />
                <span>Observatory</span>
                <span className="nav-count">{state.sessions.length}</span>
              </SidebarItem>
            )}
            {!(collapsed || wall) && (
              <>
                <SidebarPartition>RECENT RECORDINGS</SidebarPartition>
                <div className="session-nav">
                  {state.sessions.slice(0, 14).map((session) => (
                    <SidebarItem
                      key={sessionKey(session)}
                      active={state.selected !== null && sessionKey(session) === sessionKey(state.selected)}
                      onClick={() => choose(session)}
                    >
                      <span
                        className={`status-dot ${sessionStatus(session, state.now).toLowerCase().replaceAll(" ", "-")}`}
                      />
                      <span className="nav-session">
                        <span>{directoryName(session.cwd)}</span>
                        <small>{session.sessionId.slice(-8) || "Unassigned"}</small>
                      </span>
                    </SidebarItem>
                  ))}
                </div>
              </>
            )}
          </SidebarNav>
          <SidebarFooter>
            {!(collapsed || wall) && (
              <div className="side-footer">
                <ShieldCheck />
                <div>
                  Local & passive<small>Seven days of history</small>
                </div>
              </div>
            )}
          </SidebarFooter>
        </Sidebar>
        <AppMain id="main-content" tabIndex={-1}>
          <AppHeader
            className="kite-header"
            leading={
              <IconButton
                label="Toggle navigation"
                onClick={() => {
                  setWall(false);
                  setCollapsed(!collapsed);
                }}
              >
                <Menu />
              </IconButton>
            }
            breadcrumbs={[{ label: "Kite", href: "/" }]}
            title={state.selected ? directoryName(state.selected.cwd) : "Observatory"}
            actions={
              <>
                <span
                  className={`connection ${state.connected ? "connected" : "disconnected"}`}
                  role="status"
                >
                  <span className="status-dot" />
                  {state.connected
                    ? "Collector connected"
                    : state.loading
                      ? "Connecting"
                      : "Collector offline"}
                </span>
                <IconButton label={wall ? "Exit wall view" : "Wall view"} onClick={() => setWall(!wall)}>
                  <Maximize2 />
                </IconButton>
                <ThemeToggle aria-label="Change theme" />
              </>
            }
          />
          <ContentIsland id="observatory-content" className="kite-island">
            {state.error && (
              <div className="notice error" role="alert">
                <TriangleAlert />
                <span>
                  {state.error}. Start <code>npm start</code> to resume observation. Existing history stays on
                  this machine.
                </span>
                <Button variant="outline" size="sm" onClick={() => void vm.refresh()}>
                  <RefreshCw />
                  Retry
                </Button>
              </div>
            )}
            {state.selected ? (
              <Detail vm={vm} state={state} session={state.selected} />
            ) : (
              <Overview vm={vm} state={state} />
            )}
          </ContentIsland>
        </AppMain>
      </AppShell>
    </SidebarProvider>
  );
}

function Overview({ vm, state }: { vm: Observatory; state: ObservatoryState }) {
  const sessions = state.sessions.filter((session) =>
    `${session.cwd} ${session.sessionId} ${session.model} ${session.provider}`
      .toLowerCase()
      .includes(state.sessionSearch.toLowerCase()),
  );
  const active = state.sessions.filter((session) => sessionStatus(session, state.now) === "Running");
  const metrics = [
    {
      label: "RECENT RUN ACTIVITY",
      value: active.length,
      caption: "Observed within 30 seconds",
      icon: Radio,
    },
    { label: "RECORDINGS", value: state.sessions.length, caption: "Across Pi sessions", icon: Layers3 },
    {
      label: "OBSERVATIONS",
      value: state.sessions.reduce((n, s) => n + s.eventCount, 0),
      caption: "Hooks captured locally",
      icon: Activity,
    },
    {
      label: "TOOL ATTEMPTS",
      value: state.sessions.reduce((n, s) => n + s.toolCount, 0),
      caption: "Including rejected calls",
      icon: Terminal,
    },
  ];
  return (
    <div className="page-enter">
      <PageHeader
        title={
          <span className="page-title">
            Pi, in motion<span className="title-dot">.</span>
          </span>
        }
        description="A window into every session. Follow the work, one observation at a time."
        actions={
          <Badge variant="outline">
            <Database />
            7-day local history
          </Badge>
        }
      />
      <div className="metrics">
        {metrics.map(({ label, value, caption, icon: Icon }) => (
          <LayerCard key={label} className="metric" padding="none">
            <div className="metric-label">
              <span>{label}</span>
              <Icon />
            </div>
            <strong>{state.loading || !state.connected ? "—" : value.toLocaleString()}</strong>
            <small>{caption}</small>
          </LayerCard>
        ))}
      </div>
      <SectionRule
        title="Session flight deck"
        actions={
          <div className="search-field">
            <Search />
            <Input
              aria-label="Search sessions"
              placeholder="Directory, session or model…"
              value={state.sessionSearch}
              onChange={(event) => vm.setSessionSearch(event.target.value)}
            />
          </div>
        }
      />
      {state.loading ? (
        <div className="skeleton-grid">
          {[1, 2, 3].map((n) => (
            <LayerCard.Loading key={n} label="Loading sessions" />
          ))}
        </div>
      ) : sessions.length === 0 ? (
        <LayerCard className="empty-card">
          <div className="empty-orbit">
            <Feather />
            <span />
            <span />
          </div>
          <h2>{state.sessionSearch ? "No matching sessions" : "Ready when Pi is."}</h2>
          <p>
            {state.sessionSearch
              ? "Try a directory, session ID or model name."
              : "Start a Pi session with the Kite extension. Its working directory and every observed step will appear here."}
          </p>
          {state.sessionSearch ? (
            <Button variant="outline" onClick={() => vm.setSessionSearch("")}>
              Clear search
            </Button>
          ) : (
            <div className="empty-hint">
              <Terminal />
              <code>pi</code>
              <span>Global extension · local observation</span>
            </div>
          )}
        </LayerCard>
      ) : (
        <div className="flight-deck">
          {sessions.map((session) => (
            <SessionCard
              key={sessionKey(session)}
              session={session}
              now={state.now}
              connected={state.connected}
              onOpen={() => void vm.select(session)}
            />
          ))}
        </div>
      )}
      <div className="overview-foot">
        <span>
          <CircleDot />
          Observed facts, not inferred internals
        </span>
        <span>Quiet after 30s without events · retention by receipt time</span>
      </div>
    </div>
  );
}

function SessionCard({
  session,
  now,
  connected,
  onOpen,
}: {
  session: SessionSummary;
  now: number;
  connected: boolean;
  onOpen: () => void;
}) {
  const status = sessionStatus(session, now);
  const phase = eventInfo({ name: session.lastActivity || session.lastEvent, payload: null }).module;
  const live = connected && status === "Running";
  return (
    <LayerCard className={`session-card ${live ? "session-live" : ""}`} padding="none">
      <div className="session-card-heading">
        <div className="project-icon">
          <Folder />
        </div>
        <div className="session-title">
          <Button variant="ghost" onClick={onOpen} className="title-button">
            {directoryName(session.cwd)}
            <ArrowRight />
          </Button>
          <span className="mono muted">
            {session.sessionId.slice(-8) || "Unassigned session"}{" "}
            <span className="recording-id">/ {session.producerId.slice(0, 6)}</span>
          </span>
        </div>
        <Badge variant={live ? "info" : status === "Awaiting input" ? "warning" : "secondary"} dot>
          {status}
        </Badge>
      </div>
      <p className="session-directory" title={session.cwd || "Directory not observed"}>
        {session.cwd || "Directory not observed"}
      </p>
      <div className="mini-track" role="img" aria-label={`Latest module: ${phase}`}>
        {(["input", "context", "provider", "response", "tools", "settle"] as ModuleId[]).map((id) => {
          const Icon = icons[id];
          return (
            <div key={id} className={`mini-phase ${phase === id ? "current" : ""} ${live ? "animate" : ""}`}>
              <span>
                <Icon />
              </span>
              <small>{id}</small>
            </div>
          );
        })}
      </div>
      <div className="session-current">
        <span className={`status-dot ${live ? "running" : ""}`} />
        <span>{eventInfo({ name: session.lastActivity || session.lastEvent, payload: null }).label}</span>
        <time>{duration(now - session.lastSeen)} ago</time>
      </div>
      <div className="session-card-footer">
        <span title={session.model || "Model not observed"}>{session.model || "Model not observed"}</span>
        <span>{session.eventCount.toLocaleString()} events</span>
        <IconButton
          label={`Inspect ${directoryName(session.cwd)} ${session.producerId.slice(0, 6)}`}
          onClick={onOpen}
        >
          <ArrowRight />
        </IconButton>
      </div>
      {(session.errorCount > 0 || session.lossCount > 0) && (
        <div className="card-warning">
          <TriangleAlert />
          {session.errorCount} tool errors · {session.lossCount} loss notices
        </div>
      )}
    </LayerCard>
  );
}

function Detail({
  vm,
  state,
  session,
}: {
  vm: Observatory;
  state: ObservatoryState;
  session: SessionSummary;
}) {
  const projection = useMemo(() => project(state.events, state.index), [state.events, state.index]);
  const current = state.events[state.index];
  const events = useMemo(
    () => filteredEvents(state.events.slice(0, state.index + 1), state.filter, state.search).reverse(),
    [state.events, state.index, state.filter, state.search],
  );
  return (
    <div className="detail-page page-enter">
      <div className="detail-back">
        <Button variant="ghost" size="sm" onClick={() => void vm.select(null)}>
          <ArrowLeft />
          All sessions
        </Button>
        <span className="mono">{session.sessionId || "Unassigned session"}</span>
      </div>
      <PageHeader
        title={
          <span className="detail-title">
            <Folder />
            {directoryName(session.cwd)}
          </span>
        }
        description={<span className="mono directory-path">{session.cwd || "Directory not observed"}</span>}
        actions={
          <>
            <Badge variant={state.mode === "replay" ? "purple" : "info"} dot>
              {state.mode === "replay" ? "Replay" : "Live"}
            </Badge>
            <Badge variant="secondary">
              {state.mode === "live" ? sessionStatus(session, state.now) : projection.status}
            </Badge>
          </>
        }
      />
      <div className="recording-meta">
        <span>
          <Globe2 />
          {session.provider || "Unknown provider"} / {session.model || "Unknown model"}
        </span>
        <span>
          <GitBranch />
          Recording {session.producerId.slice(0, 8)}
        </span>
        <span>
          <Clock3 />
          {new Date(session.firstSeen).toLocaleString()}
        </span>
      </div>
      <ReplayBar state={state} vm={vm} />
      {state.detailError && (
        <div className="notice error" role="alert">
          <TriangleAlert />
          <span>{state.detailError}</span>
          <Button variant="outline" size="sm" onClick={() => void vm.retryDetail()}>
            Retry
          </Button>
        </div>
      )}
      {(projection.gaps > 0 || projection.loss > 0) && (
        <div className="notice warning">
          <TriangleAlert />
          <span>
            Incomplete observation: {projection.gaps} missing sequence positions, {projection.loss} reported
            dropped events. These counts may overlap.
          </span>
        </div>
      )}
      <SectionRule
        title="Runtime anatomy"
        hint="Each highlight comes from a captured hook. Connections show Pi's conceptual flow, not unobserved internal calls."
        actions={
          <span className="small muted">
            {state.page > 0 ? `Segment ${state.page + 1} · ` : ""}
            {projection.runs} runs · {projection.turns} turns · {projection.chunks} chunks
          </span>
        }
      />
      <LayerCard className="runtime-card" padding="none">
        <LayerCard.Header className="runtime-heading">
          <div className="row">
            <span
              className={`status-dot ${state.playing || (state.mode === "live" && sessionStatus(session, state.now) === "Running" && state.connected) ? "running" : ""}`}
            />
            <strong>{current ? eventInfo(current).label : "Waiting for observations"}</strong>
          </div>
          <span className="mono muted">{current ? current.name : "—"}</span>
        </LayerCard.Header>
        <RuntimeMap
          projection={projection}
          selected={state.filter}
          onSelect={(id) => vm.setFilter(state.filter === id ? "all" : id)}
          animate={
            state.playing ||
            (state.mode === "live" && sessionStatus(session, state.now) === "Running" && state.connected)
          }
          cursor={current?.cursor ?? 0}
        />
        <div className="runtime-legend">
          <span>
            <i className="legend-active" />
            Current observation
          </span>
          <span>
            <i className="legend-visited" />
            Observed in this segment
          </span>
          <span>
            <i />
            Not observed in this segment
          </span>
          <span className="legend-hint">Select a module to filter the timeline</span>
        </div>
      </LayerCard>
      <div className="evidence-grid">
        <LayerCard className="timeline-card" padding="none">
          <LayerCard.Header>
            <div className="row">
              <Activity />
              <strong>Step timeline</strong>
              <Badge variant="secondary">{events.length}</Badge>
            </div>
            {state.filter !== "all" && (
              <Button variant="ghost" size="sm" onClick={() => vm.setFilter("all")}>
                {state.filter}
                <X />
              </Button>
            )}
          </LayerCard.Header>
          <div className="timeline-search">
            <Search />
            <Input
              aria-label="Search events"
              placeholder="Search hooks or event content…"
              value={state.search}
              onChange={(event) => vm.setSearch(event.target.value)}
            />
          </div>
          <section className="event-list" aria-label="Observed event timeline">
            {state.detailLoading && events.length === 0 ? (
              <LayerCard.Loading label="Loading observations" />
            ) : events.length === 0 ? (
              <p className="list-empty">No matching observations at this step.</p>
            ) : (
              events.map((event) => (
                <EventRow
                  key={event.cursor}
                  event={event}
                  current={event.cursor === current?.cursor}
                  first={state.events[0]?.monotonicMs ?? 0}
                  onClick={() => vm.seek(state.events.findIndex((item) => item.cursor === event.cursor))}
                />
              ))
            )}
          </section>
        </LayerCard>
        <div className="inspector-stack">
          <LayerCard className="event-inspector" padding="none">
            <LayerCard.Header>
              <div className="row">
                <ScanLine />
                <strong>Observation</strong>
              </div>
              <span className="mono small muted">#{current?.seq ?? "—"}</span>
            </LayerCard.Header>
            {current ? (
              <LayerCard.Body>
                <div className="inspector-title">
                  <Badge variant="outline">{eventInfo(current).module}</Badge>
                  <strong>{eventInfo(current).label}</strong>
                </div>
                <p className="event-explanation">{eventInfo(current).description}</p>
                <div className="fact-grid">
                  <span>
                    Hook<strong className="mono">{current.name}</strong>
                  </span>
                  <span>
                    Observed at
                    <strong className="mono">{new Date(current.timestamp).toLocaleTimeString()}</strong>
                  </span>
                  <span>
                    Run
                    <strong className="mono">
                      {String(current.correlation?.runId ?? "—")
                        .split(":")
                        .at(-1)}
                    </strong>
                  </span>
                  <span>
                    Turn<strong>{current.correlation?.turnIndex ?? "—"}</strong>
                  </span>
                </div>
                <details className="payload" open>
                  <summary>
                    Captured payload <FileText />
                  </summary>
                  <pre>{JSON.stringify(current.payload, null, 2)}</pre>
                </details>
              </LayerCard.Body>
            ) : (
              <LayerCard.Empty
                title="No observation selected"
                description="Choose a step to inspect its captured facts."
              />
            )}
          </LayerCard>
          <ToolPanel
            projection={projection}
            onSelect={(cursor) => vm.seek(state.events.findIndex((event) => event.cursor === cursor))}
          />
          {(projection.text || projection.thinking) && (
            <LayerCard className="response-card">
              <div className="row">
                <AudioLines />
                <strong>Latest assistant message</strong>
                <span className="small muted">{projection.tokens.toLocaleString()} tokens in segment</span>
              </div>
              {projection.thinking && (
                <details>
                  <summary>Provider-exposed thinking</summary>
                  <pre>{projection.thinking}</pre>
                </details>
              )}
              {projection.text && <pre>{projection.text}</pre>}
            </LayerCard>
          )}
        </div>
      </div>
      <p className="detail-foot">
        500 events per segment, at most 4 MiB. Replay traverses retained segments. Earlier context may be
        outside this segment; original payloads preserve capture limits.
      </p>
    </div>
  );
}

function ReplayBar({ state, vm }: { state: ObservatoryState; vm: Observatory }) {
  return (
    <LayerCard className="replay-bar" padding="none">
      <div className="replay-actions">
        <div className="row">
          <IconButton
            label="Previous segment"
            disabled={state.page === 0 || state.detailLoading}
            onClick={() => void vm.page(-1)}
          >
            <SkipBack />
          </IconButton>
          <IconButton
            label="Previous step"
            disabled={state.index <= 0 || state.detailLoading}
            onClick={() => vm.seek(state.index - 1)}
          >
            <ChevronLeft />
          </IconButton>
          <Button
            className="play-button"
            size="icon"
            aria-label={state.playing ? "Pause replay" : "Play replay"}
            disabled={!state.events.length || state.detailLoading}
            onClick={() => vm.play()}
          >
            {state.playing ? <Pause /> : <Play />}
          </Button>
          <IconButton
            label="Next step"
            disabled={state.index >= state.events.length - 1 || state.detailLoading}
            onClick={() => vm.seek(state.index + 1)}
          >
            <ChevronRight />
          </IconButton>
          <IconButton
            label="Next segment"
            disabled={!state.hasNext || state.detailLoading}
            onClick={() => void vm.page(1)}
          >
            <SkipForward />
          </IconButton>
        </div>
        <div className="replay-readout">
          <strong>
            {state.mode === "live" ? "LIVE EDGE" : state.playing ? "REPLAYING" : "REPLAY PAUSED"}
          </strong>
          <span className="mono">
            {duration(state.time)}{" "}
            <span className="muted">
              · {state.index + 1} / {state.events.length}
            </span>
          </span>
        </div>
        <div className="row replay-options">
          <Select value={state.pace} onValueChange={(value) => vm.setPace(value as "steps" | "recorded")}>
            <SelectTrigger size="sm" aria-label="Replay timing">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="steps">Step by step</SelectItem>
              <SelectItem value="recorded">Recorded timing</SelectItem>
            </SelectContent>
          </Select>
          <Select value={String(state.speed)} onValueChange={(value) => vm.setSpeed(Number(value))}>
            <SelectTrigger size="sm" aria-label="Playback speed">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[0.5, 1, 2, 4, 8].map((speed) => (
                <SelectItem key={speed} value={String(speed)}>
                  {speed}×
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="ghost" size="sm" disabled={state.detailLoading} onClick={() => void vm.replay()}>
            <Clock3 />
            From start
          </Button>
          <Button
            variant={state.mode === "live" ? "secondary" : "outline"}
            size="sm"
            disabled={state.detailLoading}
            onClick={() => void vm.live()}
          >
            <Radio />
            Live
          </Button>
        </div>
      </div>
      <div className="replay-tape">
        <div className="event-marks" aria-hidden="true">
          {state.events.map((event, index) => (
            <span
              key={event.cursor}
              className={`mark phase-${eventInfo(event).module} ${index <= state.index ? "played" : ""}`}
            />
          ))}
        </div>
        <Slider
          aria-label="Replay step"
          min={0}
          max={Math.max(1, state.events.length - 1)}
          step={1}
          value={[Math.max(0, state.index)]}
          onValueChange={(value) => vm.seek(value[0] ?? 0)}
          disabled={state.events.length < 2 || state.detailLoading}
        />
      </div>
    </LayerCard>
  );
}

const connections: [ModuleId, ModuleId, string][] = [
  ["session", "input", "M114 116V154"],
  ["input", "context", "M198 200H228"],
  ["context", "provider", "M396 200H426"],
  ["provider", "response", "M594 200H624"],
  ["response", "settle", "M792 200H822"],
  ["response", "tools", "M708 154V116"],
  ["tools", "context", "M624 70H450Q430 70 430 126H324Q312 126 312 154"],
  ["context", "compaction", "M275 154V116"],
];
function RuntimeMap({
  projection,
  selected,
  onSelect,
  animate,
  cursor,
}: {
  projection: Projection;
  selected: ModuleId | "all";
  onSelect: (id: ModuleId) => void;
  animate: boolean;
  cursor: number;
}) {
  return (
    <section className="map-scroll" aria-label="Pi module flow">
      <div className={`runtime-map ${animate ? "is-animating" : ""}`}>
        <svg viewBox="0 0 1020 292" className="map-connectors" aria-hidden="true">
          <defs>
            <marker id="flow-arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
              <path d="M0 0L6 3L0 6" fill="currentColor" />
            </marker>
          </defs>
          {connections.map(([from, to, path]) => (
            <g
              key={`${from}-${to}`}
              className={projection.active === to || projection.active === from ? "edge-active" : ""}
            >
              <path className="edge-base" d={path} markerEnd="url(#flow-arrow)" />
              <path className="edge-signal" d={path} />
            </g>
          ))}
          <text x="447" y="111" className="map-label">
            NEXT TURN
          </text>
          <text x="40" y="278" className="map-label">
            PI RUNTIME · OBSERVED HOOKS
          </text>
        </svg>
        {modules.map((module) => {
          const Icon = icons[module.id];
          const active = projection.active === module.id;
          const hits = projection.hits[module.id];
          return (
            <Button
              key={module.id}
              variant="ghost"
              aria-label={`${module.label} module`}
              aria-pressed={selected === module.id}
              onClick={() => onSelect(module.id)}
              style={{ left: module.x, top: module.y } as CSSProperties}
              className={`module-node phase-${module.id} ${hits ? "visited" : "unseen"} ${active ? "node-active" : ""} ${selected === module.id ? "node-selected" : ""}`}
            >
              <span className="module-top">
                <span className="module-icon">
                  <Icon />
                </span>
                <span className="module-count">{hits || "—"}</span>
              </span>
              <strong>{module.label}</strong>
              <span className="module-caption">{module.detail}</span>
              {active && <span className="node-pulse" key={cursor} />}
            </Button>
          );
        })}
        <div className="map-note">
          <span className="map-note-icon">
            <ArrowDownLeft />
          </span>
          <div>
            Follow the signal<small>Hooks light up where Pi is observed.</small>
          </div>
        </div>
      </div>
    </section>
  );
}

function EventRow({
  event,
  current,
  first,
  onClick,
}: {
  event: StoredEvent;
  current: boolean;
  first: number;
  onClick: () => void;
}) {
  const info = eventInfo(event),
    Icon = icons[info.module];
  return (
    <Button
      variant="ghost"
      className={`event-row phase-${info.module} ${current ? "selected" : ""}`}
      onClick={onClick}
      aria-pressed={current}
    >
      <span className="event-symbol">
        <Icon />
      </span>
      <span className="event-label">
        <strong>{info.label}</strong>
        <small className="mono">{event.name}</small>
      </span>
      <span className="event-time mono">+{duration(event.monotonicMs - first)}</span>
    </Button>
  );
}
function ToolPanel({ projection, onSelect }: { projection: Projection; onSelect: (cursor: number) => void }) {
  return (
    <LayerCard className="tool-card" padding="none">
      <LayerCard.Header>
        <div className="row">
          <Workflow />
          <strong>Tool attempts</strong>
          <Badge variant="secondary">{projection.tools.length}</Badge>
        </div>
        <span className="small muted">Parallel order preserved</span>
      </LayerCard.Header>
      {projection.tools.length === 0 ? (
        <div className="tool-empty">
          <Terminal />
          <span>No tool attempts in this segment yet.</span>
        </div>
      ) : (
        <div className="tool-list">
          {projection.tools.map((tool) => (
            <Button
              variant="ghost"
              key={tool.id}
              className={`tool-row ${tool.status}`}
              onClick={() => onSelect(tool.cursor)}
            >
              <Terminal />
              <span>
                <strong>{tool.name}</strong>
                <small className="mono">{tool.id.split(":").at(-1)}</small>
              </span>
              <Badge variant={tool.status === "error" ? "error" : "secondary"}>{tool.status}</Badge>
              <span className="mono small">
                {tool.start === undefined
                  ? "Unknown duration"
                  : tool.end === undefined
                    ? "…"
                    : duration(tool.end - tool.start)}
              </span>
            </Button>
          ))}
        </div>
      )}
      <div className="tool-caveat">
        An attempt begins before validation. Rejected calls can appear here without a tool body running.
      </div>
    </LayerCard>
  );
}
