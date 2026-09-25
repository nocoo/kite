import { Button } from "@nocoo/basalt";
import {
  AudioLines,
  Blocks,
  Check,
  ChevronLeft,
  ChevronRight,
  Database,
  Globe2,
  Layers3,
  Terminal,
  Workflow,
} from "lucide-react";
import { type CSSProperties, useState } from "react";
import type { SessionSummary } from "../src/store.ts";
import { IconButton } from "./controls.tsx";
import {
  duration,
  eventInfo,
  type fleetSummary,
  type ModuleId,
  modules,
  type Projection,
  type ToolAttempt,
  toolWindow,
} from "./model.ts";

export const moduleIcons = {
  session: Layers3,
  input: Terminal,
  context: Blocks,
  provider: Globe2,
  response: AudioLines,
  tools: Workflow,
  settle: Check,
  compaction: Database,
};
const locations: Record<ModuleId, [number, number]> = {
  session: [14, 18],
  input: [38, 18],
  context: [62, 18],
  compaction: [86, 18],
  provider: [38, 47],
  response: [62, 47],
  settle: [86, 47],
  tools: [14, 79],
};
const connections: [ModuleId, ModuleId, string][] = [
  ["session", "input", "M230 180H290"],
  ["input", "context", "M470 180H530"],
  ["context", "provider", "M620 270V315Q620 335 600 335H400Q380 335 380 355V380"],
  ["context", "compaction", "M710 180H770"],
  ["provider", "response", "M470 470H530"],
  ["response", "settle", "M710 470H770"],
  ["response", "tools", "M620 560V600Q620 620 600 620H160Q140 620 140 640V680"],
  [
    "tools",
    "context",
    "M140 680V595Q140 575 160 575H250Q270 575 270 555V335Q270 315 290 315H540Q560 315 560 295V270",
  ],
  ["compaction", "context", "M860 90V55Q860 35 840 35H640Q620 35 620 55V90"],
];
export const toolStages = [
  ["tool_execution_start", "Start"],
  ["tool_call", "Check"],
  ["tool_execution_update", "Emit"],
  ["tool_result", "Result"],
  ["tool_execution_end", "End"],
] as const;

export function ToolStages({ tool }: { tool: ToolAttempt }) {
  return (
    <span role="img" className="tool-stages" aria-label={`Observed stages: ${tool.hooks.join(", ")}`}>
      {toolStages.map(([hook, label]) => (
        <span
          key={hook}
          className={tool.hooks.includes(hook) ? "observed" : ""}
          title={`${label}: ${tool.hooks.includes(hook) ? "observed" : "not observed"}`}
        >
          <i />
          {label}
        </span>
      ))}
    </span>
  );
}

export function ExecutionMap({
  projection,
  fleet,
  session,
  animate,
  signals,
  filter,
  onModule,
  onTool,
  onExpand,
  onChoose,
  sessions,
}: {
  projection: Projection;
  fleet: ReturnType<typeof fleetSummary>;
  session: SessionSummary | null;
  animate: boolean;
  signals: ModuleId[];
  filter: ModuleId | "all";
  onModule: (id: ModuleId) => void;
  onTool: (tool: ToolAttempt) => void;
  onExpand: () => void;
  onChoose: (session: SessionSummary) => void;
  sessions: SessionSummary[];
}) {
  const [manualPage, setManualPage] = useState<number | null>(null);
  const window = toolWindow(projection.tools, manualPage);
  const active = session ? projection.active : null;
  return (
    <section
      className={`execution-map ${animate ? "is-animating" : ""}`}
      aria-label={session ? "Pi execution map" : "Fleet phase map"}
    >
      <div className="map-coordinate coord-top">
        {session ? "01 / RUNTIME CONTROL" : "01 / FLEET · LATEST OBSERVED MODULE"}
      </div>
      <div className="map-coordinate coord-cycle">02 / INFERENCE CYCLE</div>
      <div className="map-coordinate coord-tools">03 / TOOL DISPATCH</div>
      <svg className="map-wires" viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true">
        <path className="wire fleet-uplink" d="M0 180H50" />
        {connections.map(([from, to, path]) => (
          <g
            key={`${from}-${to}`}
            className={`phase-${to} ${active === to || signals.includes(to) ? "energized" : ""}`}
          >
            <path className="wire" d={path} />
            <path className="signal" d={path} />
          </g>
        ))}
        {[380, 620, 860].map((x) => (
          <g
            key={x}
            className={`phase-tools ${active === "tools" || signals.includes("tools") ? "energized" : ""}`}
          >
            <path
              className="wire"
              d={`M230 790H250Q260 790 260 780V665Q260 650 275 650H${x - 15}Q${x} 650 ${x} 665V680`}
            />
            <path
              className="signal"
              d={`M230 790H250Q260 790 260 780V665Q260 650 275 650H${x - 15}Q${x} 650 ${x} 665V680`}
            />
          </g>
        ))}
      </svg>
      <div
        role="img"
        className={`cycle-core ${animate ? "core-active" : ""}`}
        aria-label={
          session ? `${projection.turns} observed turns in segment` : `${fleet.running} running sessions`
        }
      >
        <svg viewBox="0 0 120 120" aria-hidden="true">
          <circle className="core-orbit" cx="60" cy="60" r="56" />
          {modules.map((m, i) => (
            <circle
              key={m.id}
              className={`phase-${m.id} core-segment ${active === m.id ? "core-current" : ""} ${(session ? projection.hits[m.id] : fleet.phases[m.id]) > 0 ? "seen" : ""}`}
              cx="60"
              cy="60"
              r="48"
              strokeDasharray="30 272"
              transform={`rotate(${i * 45 - 90} 60 60)`}
            />
          ))}
        </svg>
        <div>
          <span className="eyebrow">{session ? "AGENT LOOP" : "GLOBAL SIGNAL"}</span>
          <strong>{session ? projection.turns : fleet.running}</strong>
          <span>{session ? "observed turns" : "running sessions"}</span>
        </div>
      </div>
      {modules.map((module, i) => {
        const Icon = moduleIcons[module.id];
        const latest = projection.latest[module.id];
        const hits = session ? projection.hits[module.id] : fleet.phases[module.id];
        const [x, y] = locations[module.id];
        return (
          <Button
            key={module.id}
            variant="ghost"
            aria-label={`${module.label} module`}
            aria-pressed={filter === module.id}
            onClick={() => onModule(module.id)}
            className={`module-node phase-${module.id} ${hits ? "visited" : "unseen"} ${active === module.id ? "node-active" : ""} ${signals.includes(module.id) ? "node-recent" : ""} ${filter === module.id ? "node-selected" : ""}`}
            style={{ left: `${x}%`, top: `${y}%` } as CSSProperties}
          >
            <span className="module-top">
              <Icon />
              <span className="module-number">{String(i + 1).padStart(2, "0")}</span>
              <span className="module-count">
                {hits}
                <small>{session ? "hooks" : "sessions"}</small>
              </span>
            </span>
            <strong>{module.label}</strong>
            <span className="module-caption">
              {session ? (latest ? eventInfo(latest).label : "Not observed in segment") : module.detail}
            </span>
            <span className="module-trace" aria-hidden="true">
              {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((n) => (
                <i key={n} className={n < Math.min(hits, 12) ? "lit" : ""} />
              ))}
            </span>
          </Button>
        );
      })}
      {session
        ? [0, 1, 2].map((slot) => {
            const tool = window.tools[slot];
            return tool ? (
              <Button
                key={slot}
                variant="ghost"
                className={`tool-node phase-tools tool-${tool.status} ${active === "tools" && projection.latest.tools?.cursor === tool.cursor ? "node-active" : ""}`}
                style={{ left: `${38 + slot * 24}%`, top: "79%" }}
                onClick={() => onTool(tool)}
                aria-label={`Inspect tool ${tool.name} ${tool.id}`}
              >
                <span className="tool-node-top">
                  <Terminal />
                  <span className="tool-status">{tool.status}</span>
                </span>
                <strong>{tool.name}</strong>
                <span className="tool-id mono" title={tool.id}>
                  {tool.id.split(":").at(-1)}
                </span>
                <ToolStages tool={tool} />
                <span className="tool-duration mono">
                  {tool.start === undefined || tool.end === undefined
                    ? "Duration not observed"
                    : duration(tool.end - tool.start)}
                </span>
              </Button>
            ) : (
              <div key={slot} className="tool-vacant" style={{ left: `${38 + slot * 24}%`, top: "79%" }}>
                <Terminal />
                <span>No attempt observed</span>
                <small>Tool calls appear here</small>
              </div>
            );
          })
        : [0, 1, 2].map((slot) => {
            const item = sessions[slot];
            return (
              <div key={slot} className="fleet-instrument" style={{ left: `${38 + slot * 24}%`, top: "79%" }}>
                <span className="eyebrow">{["CAPTURED", "TOOL ATTEMPTS", "TOOL ERRORS"][slot]}</span>
                <strong>{[fleet.observations, fleet.tools, fleet.errors][slot]?.toLocaleString()}</strong>
                <span>{["observations / 7 days", "across all recordings", "observed end events"][slot]}</span>
                {item && (
                  <Button variant="ghost" size="sm" onClick={() => onChoose(item)}>
                    Explore a recording →
                  </Button>
                )}
              </div>
            );
          })}
      <div className="map-bottom">
        <span className="map-scope">
          {session
            ? `${projection.tools.length} attempts in segment`
            : "Select a session to expand its tools"}
        </span>
        {session && (
          <div className="row tool-pagination">
            <IconButton
              label="Previous tool group"
              disabled={window.page === 0}
              onClick={() => setManualPage(window.page - 1)}
            >
              <ChevronLeft />
            </IconButton>
            <span className="mono">
              {window.tools.length ? window.offset + 1 : 0}–{window.offset + window.tools.length} /{" "}
              {projection.tools.length}
            </span>
            <IconButton
              label="Next tool group"
              disabled={window.page + 1 >= window.pages}
              onClick={() => setManualPage(window.page + 1)}
            >
              <ChevronRight />
            </IconButton>
            <Button
              variant="ghost"
              size="sm"
              aria-pressed={manualPage === null}
              onClick={() => setManualPage(null)}
            >
              Follow
            </Button>
            <Button variant="ghost" size="sm" onClick={onExpand}>
              All tools
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}
