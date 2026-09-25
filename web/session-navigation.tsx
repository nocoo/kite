import { Button, Input, Tooltip, TooltipContent, TooltipTrigger } from "@nocoo/basalt";
import { SidebarIconItem, SidebarItem, SidebarNav, SidebarPartition } from "@nocoo/basalt/components/sidebar";
import { Network, Radio, Search, X } from "lucide-react";
import { useLayoutEffect, useRef } from "react";
import type { SessionSummary } from "../src/store.ts";
import {
  directoryName,
  eventInfo,
  filteredSessions,
  modules,
  sessionGroups,
  sessionKey,
  sessionStatus,
} from "./model.ts";
import type { Observatory, ObservatoryState } from "./view-model.ts";

function RecordingItem({
  session,
  state,
  collapsed,
  onSelect,
}: {
  session: SessionSummary;
  state: ObservatoryState;
  collapsed: boolean;
  onSelect: (session: SessionSummary) => void;
}) {
  const status = sessionStatus(session, state.now);
  const phase = eventInfo({ name: session.lastEvent, payload: null }).module;
  const directory = directoryName(session.cwd);
  const identity = `${session.sessionId.slice(-8) || "Unassigned"} · ${session.producerId.slice(0, 6)}`;
  const active = state.selected !== null && sessionKey(session) === sessionKey(state.selected);
  const live = state.connected && status === "Running";
  const observedStatus = state.connected ? status : `Offline · last observed ${status}`;
  const title = `${session.cwd || "Directory not observed"}\n${identity}\n${observedStatus} · ${phase}\n${session.eventCount.toLocaleString()} observations · ${session.toolCount} tools`;
  const Item = collapsed ? SidebarIconItem : SidebarItem;
  const item = (
    <Item
      active={active}
      className={`session-item phase-${phase} ${collapsed ? "session-icon" : ""}`}
      data-session-key={sessionKey(session)}
      data-live={live}
      aria-label={`Inspect ${directory} ${session.producerId.slice(0, 6)} · ${observedStatus}`}
      onClick={() => onSelect(session)}
      title={collapsed ? undefined : title}
    >
      <span className={`session-beacon ${live ? "is-live" : ""}`} role="img" aria-label={observedStatus} />
      {collapsed ? (
        <span className="session-initial">{directory.slice(0, 1).toUpperCase()}</span>
      ) : (
        <span className="session-copy">
          <span className="session-title">
            <strong>{directory}</strong>
            <span className="session-status">{state.connected ? status : "Offline"}</span>
          </span>
          <span className="session-identity mono">{identity}</span>
          <span className="session-phase-track" role="img" aria-label={`Latest observed module: ${phase}`}>
            {modules.map((module) => (
              <i key={module.id} className={`phase-${module.id} ${module.id === phase ? "lit" : ""}`} />
            ))}
          </span>
        </span>
      )}
    </Item>
  );
  return collapsed ? (
    <Tooltip delayDuration={0}>
      <TooltipTrigger asChild>{item}</TooltipTrigger>
      <TooltipContent side="right" className="session-tooltip">
        {title}
      </TooltipContent>
    </Tooltip>
  ) : (
    item
  );
}

export function SessionNavigation({
  state,
  vm,
  collapsed,
  onSelect,
  onExpand,
}: {
  state: ObservatoryState;
  vm: Observatory;
  collapsed: boolean;
  onSelect: (session: SessionSummary | null) => void;
  onExpand: () => void;
}) {
  const searchInput = useRef<HTMLInputElement>(null);
  const searchRequested = useRef(false);
  const focused = useRef<{ key: string; navigation: HTMLElement } | null>(null);
  useLayoutEffect(() => {
    if (collapsed || !searchRequested.current) return;
    searchRequested.current = false;
    searchInput.current?.focus();
  }, [collapsed]);
  useLayoutEffect(() => {
    const previous = focused.current;
    if (!previous || document.activeElement !== document.body) return;
    const item = Array.from(previous.navigation.querySelectorAll<HTMLElement>("[data-session-key]")).find(
      (element) => element.dataset.sessionKey === previous.key,
    );
    focused.current = null;
    item?.focus();
  });
  const phase = state.selected ? "all" : state.filter;
  const sessions = filteredSessions(
    state.sessions,
    state.sessionSearch,
    phase,
    state.runningOnly ? state.now : null,
  );
  const groups = sessionGroups(sessions, state.now);
  const filtered = Boolean(state.sessionSearch || state.runningOnly || phase !== "all");
  const Overview = collapsed ? SidebarIconItem : SidebarItem;
  return (
    <>
      <div className={`sidebar-controls ${collapsed ? "is-collapsed" : ""}`}>
        <Tooltip delayDuration={0}>
          <TooltipTrigger asChild>
            <Overview active={!state.selected} onClick={() => onSelect(null)} aria-label="All sessions">
              <Network />
              {!collapsed && (
                <>
                  <span>Observatory</span>
                  <span className="nav-count">{state.sessions.length}</span>
                </>
              )}
            </Overview>
          </TooltipTrigger>
          {collapsed && <TooltipContent side="right">Observatory</TooltipContent>}
        </Tooltip>
        {collapsed ? (
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <SidebarIconItem
                onClick={() => {
                  searchRequested.current = true;
                  onExpand();
                }}
                aria-label="Find sessions"
              >
                <Search />
              </SidebarIconItem>
            </TooltipTrigger>
            <TooltipContent side="right">Find sessions</TooltipContent>
          </Tooltip>
        ) : (
          <div className="session-search">
            <Search aria-hidden="true" />
            <Input
              ref={searchInput}
              aria-label="Search sessions"
              placeholder="Directory, session, model…"
              value={state.sessionSearch}
              onChange={(event) => vm.setSessionSearch(event.target.value)}
            />
          </div>
        )}
        <div className="session-filters">
          <Button
            variant="ghost"
            size="sm"
            className="live-filter"
            aria-label="Filter live sessions"
            aria-pressed={state.runningOnly}
            onClick={() => vm.setRunningOnly(!state.runningOnly)}
            title="Filter live sessions"
          >
            <Radio />
            {!collapsed && <span>Live only</span>}
          </Button>
          {!collapsed && (
            <span className="session-filter-count mono">
              {sessions.length} shown{phase !== "all" && ` · ${phase}`}
            </span>
          )}
          {filtered && (
            <Button
              variant="ghost"
              size="icon"
              className="session-clear"
              aria-label="Clear session filters"
              title="Clear session filters"
              onClick={() => {
                vm.setSessionSearch("");
                vm.setFilter("all");
                vm.setRunningOnly(false);
              }}
            >
              <X />
            </Button>
          )}
        </div>
      </div>
      <SidebarNav
        aria-label="Observatory navigation"
        className={`session-navigation ${collapsed ? "is-collapsed" : ""}`}
        onFocusCapture={(event) => {
          const key = (event.target as HTMLElement).closest<HTMLElement>("[data-session-key]")?.dataset
            .sessionKey;
          focused.current = key ? { key, navigation: event.currentTarget } : null;
        }}
        onBlurCapture={() => {
          focused.current = null;
        }}
      >
        {Object.entries(groups).map(([group, recordings]) => (
          <section
            key={group}
            className={`session-group group-${group}`}
            aria-label={group === "live" ? "Live sessions" : "Other recordings"}
          >
            <SidebarPartition className="session-section-heading">
              {collapsed ? (
                <span>{recordings.length}</span>
              ) : (
                <>
                  <span>
                    {group === "live" ? (state.connected ? "Live" : "Last observed live") : "Recordings"}
                  </span>
                  <span className="mono">{recordings.length.toString().padStart(2, "0")}</span>
                </>
              )}
            </SidebarPartition>
            <div className="session-items">
              {recordings.map((session) => (
                <RecordingItem
                  key={sessionKey(session)}
                  session={session}
                  state={state}
                  collapsed={collapsed}
                  onSelect={onSelect}
                />
              ))}
            </div>
          </section>
        ))}
        {sessions.length === 0 && !collapsed && (
          <p className="session-empty">
            {state.loading ? "Acquiring sessions…" : filtered ? "No matching sessions" : "Waiting for Pi"}
          </p>
        )}
      </SidebarNav>
    </>
  );
}
