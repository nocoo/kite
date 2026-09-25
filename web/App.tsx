import { Badge, Button, LayerCard } from "@nocoo/basalt";
import { Banner } from "@nocoo/basalt/components/banner";
import { PageHeader } from "@nocoo/basalt/components/page-header";
import { Activity, ArrowUpRight, Database, Network, Radio, ScanLine, Terminal } from "lucide-react";
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
  eventInfo,
  fleetSummary,
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
    <AppFrame vm={vm} state={state} onSelect={choose} onRetry={() => void vm.refresh()}>
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
  const liveRunning =
    state.mode === "live" && state.connected && (session ? status === "Running" : fleet.running > 0);
  const signalState =
    state.mode === "replay" ? (state.playing ? "replaying" : "replay-paused") : liveRunning ? "running" : "";
  return (
    <div className="execution-bridge">
      <PageHeader
        title="Execution bridge"
        description="Context, inference and tools in one live map."
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
        <Button
          variant="ghost"
          size="sm"
          className="running-filter"
          aria-label="Show running sessions"
          aria-pressed={state.runningOnly}
          onClick={() => vm.setRunningOnly(!state.runningOnly)}
        >
          <Radio />
          <strong>{state.connected ? fleet.running : "—"}</strong>running
        </Button>
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
        <LayerCard.Header className="stage-heading">
          <div className="stage-identity">
            <span
              role="img"
              aria-label={
                state.mode === "replay" ? (state.playing ? "Replay playing" : "Replay paused") : status
              }
              className={`status-dot ${signalState}`}
            />
            <strong>{session ? directoryName(session.cwd) : "All systems"}</strong>
            <span className="mono stage-path" title={session?.cwd || ""}>
              {session ? session.cwd || "Directory not observed" : "Session constellation"}
            </span>
          </div>
          <div className="row">
            <Badge variant={state.mode === "replay" ? "purple" : "secondary"}>
              {state.mode === "replay" ? `Replay · ${status}` : status}
            </Badge>
            {session && (
              <Button variant="ghost" size="sm" onClick={() => onChoose(null)}>
                <Network />
                Fleet
              </Button>
            )}
          </div>
        </LayerCard.Header>
        <div className="stage-workspace">
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
            <LayerCard.Well className="signal-inspector" role="complementary" aria-label="Signal inspector">
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
            </LayerCard.Well>
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
