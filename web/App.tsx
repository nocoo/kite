import { Badge, Button, Input, LayerCard } from "@nocoo/basalt";
import { Banner } from "@nocoo/basalt/components/banner";
import { PageHeader } from "@nocoo/basalt/components/page-header";
import {
  Activity,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Database,
  Folder,
  Network,
  Radio,
  ScanLine,
  Search,
  Terminal,
  TriangleAlert,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { SessionSummary } from "../src/store.ts";
import { AppFrame } from "./app-frame.tsx";
import { IconButton } from "./controls.tsx";
import { EventButton, EvidencePanel, type EvidenceTab } from "./evidence-panel.tsx";
import { ExecutionMap } from "./execution-map.tsx";
import {
  directoryName,
  duration,
  eventInfo,
  filteredSessions,
  fleetSummary,
  modules,
  observedSignals,
  project,
  sessionKey,
  sessionStatus,
} from "./model.ts";
import { ReplayBar } from "./replay-bar.tsx";
import type { Observatory, ObservatoryState } from "./view-model.ts";

export function App({ vm }: { vm: Observatory }) {
  const state = useSyncExternalStore(vm.subscribe, vm.getSnapshot);
  useEffect(() => {
    vm.start();
    return () => vm.stop();
  }, [vm]);
  const choose = useCallback(
    (session: SessionSummary | null) => {
      void vm.select(session);
    },
    [vm],
  );
  return (
    <AppFrame state={state} onSelect={choose} onRetry={() => void vm.refresh()}>
      <Bridge vm={vm} state={state} onChoose={choose} />
    </AppFrame>
  );
}

function Bridge({
  vm,
  state,
  onChoose,
}: {
  vm: Observatory;
  state: ObservatoryState;
  onChoose: (session: SessionSummary | null) => void;
}) {
  const [tab, setTab] = useState<EvidenceTab | null>(null);
  const focusOrigin = useRef<HTMLElement | null>(null);
  const selectedKey = state.selected ? sessionKey(state.selected) : "global";
  const previousKey = useRef(selectedKey);
  useLayoutEffect(() => {
    if (previousKey.current === selectedKey) return;
    previousKey.current = selectedKey;
    setTab(null);
    document.getElementById("main-content")?.focus({ preventScroll: true });
  }, [selectedKey]);
  const open = (value: EvidenceTab) => {
    focusOrigin.current = document.activeElement as HTMLElement;
    setTab(value);
  };
  const projection = useMemo(() => project(state.events, state.index), [state.events, state.index]);
  const fleet = useMemo(() => fleetSummary(state.sessions, state.now), [state.sessions, state.now]);
  const current = state.events[state.index];
  const session = state.selected;
  const status = session
    ? state.mode === "replay"
      ? projection.status
      : sessionStatus(session, state.now)
    : "Global overview";
  const signals = session
    ? observedSignals(
        projection,
        state.mode === "live" ? state.now : (current?.monotonicMs ?? 0),
        state.mode === "live" ? "timestamp" : "monotonicMs",
      )
    : fleet.signals;
  const animate = state.playing || (state.mode === "live" && state.connected && signals.length > 0);
  return (
    <div className="execution-bridge">
      <PageHeader
        title="Execution bridge"
        description="Every signal. One field of view."
        actions={
          <>
            <Badge variant="outline">
              <Database />
              7-day history
            </Badge>
            <Button variant="outline" size="sm" disabled={!session} onClick={() => open("events")}>
              <ScanLine />
              Inspect evidence
            </Button>
          </>
        }
      />
      <section className="bridge-telemetry" aria-label="Fleet telemetry">
        <span>
          <Radio />
          <strong>{state.connected ? fleet.running : "—"}</strong>running
        </span>
        <span>
          <Network />
          <strong>{state.sessions.length}</strong>recordings
        </span>
        <span>
          <Activity />
          <strong>{fleet.observations.toLocaleString()}</strong>observations
        </span>
        <span>
          <Terminal />
          <strong>{fleet.tools.toLocaleString()}</strong>tool attempts
        </span>
        <span className="telemetry-scope">LOCAL OBSERVATION / PI</span>
      </section>
      {state.detailError && (
        <Banner
          variant="error"
          size="sm"
          role="alert"
          description={state.detailError}
          action={<Banner.Action onClick={() => void vm.retryDetail()}>Retry</Banner.Action>}
        />
      )}
      {(projection.gaps > 0 || projection.loss > 0) && (
        <Banner
          variant="alert"
          size="sm"
          description={`Incomplete observation · ${projection.gaps} missing sequence positions · ${projection.loss} reported drops. Counts may overlap.`}
        />
      )}
      <LayerCard padding="none" className="bridge-stage">
        <div className="stage-heading">
          <div className="stage-identity">
            <span className={`status-dot ${animate ? "running" : ""}`} />
            <strong>{session ? directoryName(session.cwd) : "All systems"}</strong>
            <span className="mono stage-path" title={session?.cwd || ""}>
              {session ? session.cwd || "Directory not observed" : "Session constellation"}
            </span>
          </div>
          <div className="row">
            <Badge variant={state.mode === "replay" ? "purple" : "secondary"}>{status}</Badge>
            {session && (
              <Button variant="ghost" size="sm" onClick={() => onChoose(null)}>
                <Network />
                Fleet
              </Button>
            )}
          </div>
        </div>
        <div className="stage-workspace">
          <FleetRail state={state} vm={vm} onChoose={onChoose} />
          <div className="map-column">
            <ExecutionMap
              key={selectedKey}
              projection={projection}
              fleet={fleet}
              session={session}
              sessions={state.sessions}
              animate={animate}
              filter={state.filter}
              signals={signals}
              onModule={(id) => {
                vm.setFilter(state.filter === id ? "all" : id);
                if (session) open("events");
              }}
              onTool={(tool) => {
                vm.seek(state.events.findIndex((event) => event.cursor === tool.cursor));
                open("payload");
              }}
              onExpand={() => open("tools")}
              onChoose={onChoose}
            />
            <div className="map-legend">
              <span>
                <i className="legend-current" />
                Current hook
              </span>
              <span>
                <i className="legend-seen" />
                Observed
              </span>
              <span>
                <i />
                Not observed
              </span>
              <span className="conceptual-note">Conceptual routes · highlights from captured hooks</span>
            </div>
          </div>
          {session && (
            <aside className="signal-inspector" aria-label="Signal inspector">
              <div className="eyebrow">SIGNAL INSPECTOR</div>
              <h3>{current ? eventInfo(current).label : "Awaiting observation"}</h3>
              <span className="mono small muted signal-hook">{current?.name || "—"}</span>
              <p>{current ? eventInfo(current).description : "Choose a step to inspect the signal."}</p>
              <div className="inspector-metrics">
                <span>
                  <strong>{projection.runs}</strong>runs
                </span>
                <span>
                  <strong>{projection.chunks}</strong>chunks
                </span>
                <span>
                  <strong>{projection.tokens.toLocaleString()}</strong>tokens
                </span>
              </div>
              <Button variant="outline" size="sm" onClick={() => open("payload")}>
                Open observation
                <ArrowUpRight />
              </Button>
              <div className="eyebrow inspector-subhead">LATEST ASSISTANT</div>
              <p className="response-preview">{projection.text || "No assistant text in this segment."}</p>
              <Button variant="ghost" size="sm" onClick={() => open("response")}>
                Expand response
                <ArrowUpRight />
              </Button>
              <div className="recording-identity mono">
                {session.sessionId || "Unassigned session"}
                <br />
                {session.producerId}
                <br />
                {session.provider || "Unknown provider"} / {session.model || "Unknown model"}
              </div>
            </aside>
          )}
        </div>
      </LayerCard>
      <div className="bridge-bottom">
        {session ? (
          <>
            <div className="signal-ribbon">
              <span className="eyebrow">OBSERVED SIGNAL</span>
              <div className="ribbon-events">
                {state.events.slice(Math.max(0, state.index - 2), state.index + 1).map((event) => (
                  <EventButton
                    key={event.cursor}
                    event={event}
                    current={event.cursor === current?.cursor}
                    onClick={() => {
                      vm.seek(state.events.findIndex((item) => item.cursor === event.cursor));
                      open("payload");
                    }}
                  />
                ))}
              </div>
              <IconButton label="Expand timeline" onClick={() => open("events")}>
                <ArrowUpRight />
              </IconButton>
            </div>
            <ReplayBar state={state} vm={vm} />
          </>
        ) : (
          <div className="fleet-readout">
            <div>
              <Radio />
              <strong>
                {state.loading
                  ? "Acquiring signals"
                  : state.sessions.length
                    ? "Fleet linked"
                    : "Ready when Pi is."}
              </strong>
              <span>
                {state.sessions.length
                  ? "Select a recording to expand its execution loop, tools and replay."
                  : "Start Pi with the Kite extension to see its execution here."}
              </span>
            </div>
            <span className="mono">PASSIVE / READ ONLY</span>
          </div>
        )}
      </div>
      <EvidencePanel
        tab={tab}
        onTab={setTab}
        onClose={() => setTab(null)}
        returnFocus={() => {
          const origin = focusOrigin.current;
          if (origin?.isConnected) origin.focus({ preventScroll: true });
          else document.getElementById("main-content")?.focus({ preventScroll: true });
        }}
        vm={vm}
        state={state}
        projection={projection}
      />
    </div>
  );
}

function FleetRail({
  vm,
  state,
  onChoose,
}: {
  vm: Observatory;
  state: ObservatoryState;
  onChoose: (session: SessionSummary) => void;
}) {
  const [page, setPage] = useState(0);
  const [capacity, setCapacity] = useState(6);
  const rail = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = rail.current;
    if (!element) return;
    const measure = () => {
      const { width, height } = element.getBoundingClientRect();
      setCapacity(width > 300 ? 6 : Math.max(2, Math.min(6, Math.floor((height - 98) / 74))));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const sessions = filteredSessions(
    state.sessions,
    state.sessionSearch,
    state.selected ? "all" : state.filter,
  );
  const pages = Math.max(1, Math.ceil(sessions.length / capacity));
  const currentPage = Math.min(page, pages - 1);
  return (
    <div className="fleet-rail" ref={rail}>
      <div className="fleet-heading">
        <span className="eyebrow">SESSION ARRAY</span>
        {(state.sessionSearch || (!state.selected && state.filter !== "all")) && (
          <Button
            variant="ghost"
            size="sm"
            aria-label="Clear session filters"
            onClick={() => {
              vm.setSessionSearch("");
              vm.setFilter("all");
            }}
          >
            Clear
          </Button>
        )}
        <span className="mono">{sessions.length.toString().padStart(2, "0")}</span>
      </div>
      <div className="fleet-search">
        <Search />
        <Input
          aria-label="Search sessions"
          placeholder="Find a session…"
          value={state.sessionSearch}
          onChange={(event) => {
            vm.setSessionSearch(event.target.value);
            setPage(0);
          }}
        />
      </div>
      <div className="fleet-slots" style={{ gridTemplateRows: `repeat(${capacity}, minmax(0, 1fr))` }}>
        {sessions.length === 0 && !state.loading && (
          <p className="fleet-empty">
            {state.sessionSearch || state.filter !== "all" ? "No matching sessions" : "Waiting for Pi"}
          </p>
        )}
        {[0, 1, 2, 3, 4, 5].slice(0, capacity).map((slot) => {
          const session = sessions[currentPage * capacity + slot];
          if (!session)
            return (
              <div key={`vacant-${slot}`} className="fleet-vacant">
                <span>{state.loading ? "Acquiring…" : "—"}</span>
              </div>
            );
          const status = sessionStatus(session, state.now);
          const phase = eventInfo({ name: session.lastActivity || session.lastEvent, payload: null }).module;
          return (
            <Button
              key={sessionKey(session)}
              variant="ghost"
              className={`fleet-session phase-${phase} ${state.selected && sessionKey(state.selected) === sessionKey(session) ? "selected" : ""}`}
              onClick={() => onChoose(session)}
              aria-label={`Inspect ${directoryName(session.cwd)} ${session.producerId.slice(0, 6)}`}
              title={session.cwd || "Directory not observed"}
            >
              <span className="fleet-name">
                <Folder />
                <strong>{directoryName(session.cwd)}</strong>
                <span className={`status-dot ${state.connected && status === "Running" ? "running" : ""}`} />
              </span>
              <span className="fleet-id mono">
                {session.sessionId.slice(-8) || "Unassigned"} / {session.producerId.slice(0, 6)}
              </span>
              <span className="fleet-state">
                <span>{status}</span>
                <span>{duration(state.now - session.lastSeen)} ago</span>
              </span>
              <span role="img" className="fleet-phase-track" aria-label={`Latest observed module: ${phase}`}>
                {modules.map((m) => (
                  <i key={m.id} className={`phase-${m.id} ${phase === m.id ? "lit" : ""}`} />
                ))}
              </span>
              <span className="fleet-counts">
                <span>{session.eventCount.toLocaleString()} signals</span>
                <span>{session.toolCount} tools</span>
                {session.errorCount > 0 && (
                  <span className="fleet-errors">
                    <TriangleAlert />
                    {session.errorCount}
                  </span>
                )}
              </span>
            </Button>
          );
        })}
      </div>
      <div className="fleet-pagination">
        <IconButton
          label="Previous sessions"
          disabled={currentPage === 0}
          onClick={() => setPage(currentPage - 1)}
        >
          <ChevronLeft />
        </IconButton>
        <span className="mono">
          {currentPage + 1} / {pages}
        </span>
        <IconButton
          label="Next sessions"
          disabled={currentPage + 1 === pages}
          onClick={() => setPage(currentPage + 1)}
        >
          <ChevronRight />
        </IconButton>
      </div>
    </div>
  );
}
