import { Button, ThemeToggle, Tooltip, TooltipContent, TooltipTrigger } from "@nocoo/basalt";
import { AppHeader } from "@nocoo/basalt/components/app-header";
import { AppMain, AppShell, AppSkipLink } from "@nocoo/basalt/components/app-shell";
import { Banner } from "@nocoo/basalt/components/banner";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "@nocoo/basalt/components/sheet";
import {
  ContentIsland,
  Sidebar,
  SidebarFooter,
  SidebarHeader,
  SidebarIconItem,
  SidebarItem,
  SidebarNav,
  SidebarPartition,
} from "@nocoo/basalt/components/sidebar";
import { type LinkComponent, LinkProvider } from "@nocoo/basalt/providers/link";
import {
  Maximize2,
  Menu,
  Minimize2,
  Network,
  PanelLeft,
  RefreshCw,
  ShieldCheck,
  TriangleAlert,
  X,
} from "lucide-react";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import packageInfo from "../package.json" with { type: "json" };
import type { SessionSummary } from "../src/store.ts";
import { IconButton } from "./controls.tsx";
import { directoryName, sessionKey, sessionStatus } from "./model.ts";
import type { ObservatoryState } from "./view-model.ts";
import "./frame.css";

function BrandMark() {
  return (
    <img
      className="brand-mark"
      src="/logo-24.png"
      srcSet="/logo-48.png 2x"
      width={24}
      height={24}
      alt="Kite"
    />
  );
}

function AppSidebar({
  state,
  collapsed,
  mobile,
  onToggle,
  onSelect,
}: {
  state: ObservatoryState;
  collapsed: boolean;
  mobile: boolean;
  onToggle: () => void;
  onSelect: (session: SessionSummary | null) => void;
}) {
  return (
    <Sidebar collapsed={collapsed} className="kite-sidebar">
      <SidebarHeader className={collapsed ? "brand-collapsed" : undefined}>
        {collapsed ? (
          <BrandMark />
        ) : (
          <div className="brand-row">
            <div className="brand-identity">
              <BrandMark />
              <span className="brand-name">Kite</span>
              <span className="brand-version">v{packageInfo.version}</span>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="sidebar-toggle"
              aria-label={mobile ? "Close navigation" : "Collapse sidebar"}
              onClick={onToggle}
            >
              {mobile ? <X /> : <PanelLeft />}
            </Button>
          </div>
        )}
      </SidebarHeader>
      {collapsed && (
        <Button
          variant="ghost"
          size="icon"
          className="sidebar-expand"
          aria-label="Expand sidebar"
          onClick={onToggle}
        >
          <PanelLeft />
        </Button>
      )}
      <SidebarNav aria-label="Observatory navigation" className="sidebar-navigation">
        {collapsed ? (
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <SidebarIconItem
                className="sidebar-overview-icon"
                aria-label="All sessions"
                active={!state.selected}
                onClick={() => onSelect(null)}
              >
                <Network />
              </SidebarIconItem>
            </TooltipTrigger>
            <TooltipContent side="right">Observatory</TooltipContent>
          </Tooltip>
        ) : (
          <>
            <div className="sidebar-items">
              <SidebarItem active={!state.selected} onClick={() => onSelect(null)}>
                <Network />
                <span>Observatory</span>
                <span className="nav-count">{state.sessions.length}</span>
              </SidebarItem>
            </div>
            <SidebarPartition>Recent recordings</SidebarPartition>
            <div className="sidebar-items session-nav">
              {state.sessions.slice(0, 14).map((session) => (
                <SidebarItem
                  key={sessionKey(session)}
                  active={state.selected !== null && sessionKey(session) === sessionKey(state.selected)}
                  onClick={() => onSelect(session)}
                  title={session.cwd || "Directory not observed"}
                >
                  <span
                    className={`status-dot ${sessionStatus(session, state.now).toLowerCase().replaceAll(" ", "-")}`}
                  />
                  <span className="nav-session">
                    <span>{directoryName(session.cwd)}</span>
                    <small>
                      {session.sessionId.slice(-8) || "Unassigned"} · {session.producerId.slice(0, 6)}
                    </small>
                  </span>
                </SidebarItem>
              ))}
            </div>
          </>
        )}
      </SidebarNav>
      <SidebarFooter>
        {collapsed ? (
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <span
                className="sidebar-passive"
                role="img"
                aria-label="Local and passive · Seven days of history"
              >
                <ShieldCheck />
              </span>
            </TooltipTrigger>
            <TooltipContent side="right">Local and passive · Seven days of history</TooltipContent>
          </Tooltip>
        ) : (
          <div className="side-footer">
            <ShieldCheck />
            <div>
              Local &amp; passive<small>Seven days of history</small>
            </div>
          </div>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}

export function AppFrame({
  state,
  onSelect,
  onRetry,
  children,
}: {
  state: ObservatoryState;
  onSelect: (session: SessionSummary | null) => void;
  onRetry: () => void;
  children: ReactNode;
}) {
  const [compact, setCompact] = useState(() => matchMedia("(max-width: 767px)").matches);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [wall, setWall] = useState(false);
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const focusContentOnClose = useRef(false);
  useEffect(() => {
    const query = matchMedia("(max-width: 767px)");
    const change = () => {
      setCompact(query.matches);
      setMobileOpen(false);
    };
    query.addEventListener("change", change);
    return () => query.removeEventListener("change", change);
  }, []);
  const choose = useCallback(
    (session: SessionSummary | null) => {
      if (mobileOpen) focusContentOnClose.current = true;
      onSelect(session);
      setMobileOpen(false);
    },
    [onSelect, mobileOpen],
  );
  const OverviewLink = useCallback<LinkComponent>(
    ({ href, ...props }) => (
      <a
        href={href}
        {...props}
        onClick={(event) => {
          if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          event.preventDefault();
          choose(null);
        }}
      />
    ),
    [choose],
  );
  const connection = state.connected
    ? "Collector connected"
    : state.loading
      ? "Connecting"
      : "Collector offline";
  return (
    <LinkProvider render={OverviewLink}>
      <Sheet open={compact && mobileOpen} onOpenChange={setMobileOpen}>
        <AppShell className={`kite-shell ${wall ? "wall-mode" : ""}`}>
          <AppSkipLink>Skip to observatory</AppSkipLink>
          {!compact && !wall && (
            <AppSidebar
              state={state}
              collapsed={collapsed}
              mobile={false}
              onToggle={() => setCollapsed(!collapsed)}
              onSelect={choose}
            />
          )}
          {compact && (
            <SheetContent
              side="left"
              className="kite-shell kite-navigation-sheet"
              onCloseAutoFocus={(event) => {
                if (focusContentOnClose.current || !menuTrigger.current?.isConnected) {
                  event.preventDefault();
                  document.getElementById("main-content")?.focus({ preventScroll: true });
                }
                focusContentOnClose.current = false;
              }}
            >
              <SheetTitle className="sr-only">Kite navigation</SheetTitle>
              <SheetDescription className="sr-only">Choose the overview or a Pi recording.</SheetDescription>
              <AppSidebar
                state={state}
                collapsed={false}
                mobile
                onToggle={() => setMobileOpen(false)}
                onSelect={choose}
              />
            </SheetContent>
          )}
          <AppMain id="main-content" tabIndex={-1}>
            <AppHeader
              leading={
                compact ? (
                  <SheetTrigger asChild>
                    <IconButton ref={menuTrigger} className="header-action" label="Open navigation">
                      <Menu />
                    </IconButton>
                  </SheetTrigger>
                ) : undefined
              }
              breadcrumbs={state.selected ? [{ label: "Observatory", href: "/" }] : undefined}
              title={state.selected ? directoryName(state.selected.cwd) : "Observatory"}
              actions={
                <>
                  <span
                    className={`connection ${state.connected ? "connected" : "disconnected"}`}
                    role="status"
                    aria-label={connection}
                  >
                    <span className="status-dot" />
                    <span className="connection-label">{connection}</span>
                  </span>
                  <IconButton
                    className="header-action"
                    label={wall ? "Exit wall view" : "Wall view"}
                    aria-pressed={wall}
                    onClick={() => setWall(!wall)}
                  >
                    {wall ? <Minimize2 /> : <Maximize2 />}
                  </IconButton>
                  <IconButton className="header-action" label="Kite on GitHub" asChild>
                    <a href="https://github.com/nocoo/kite" target="_blank" rel="noopener noreferrer">
                      <svg
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={1.5}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5c.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" />
                        <path d="M9 18c-4.51 2-5-2-7-2" />
                      </svg>
                      <span className="sr-only">Kite on GitHub (opens in a new tab)</span>
                    </a>
                  </IconButton>
                  <IconButton className="header-action" label="Kite on hexly.ai" asChild>
                    <a href="https://hexly.ai/projects/kite" target="_blank" rel="noopener noreferrer">
                      <svg
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={1.5}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="m12 2 8.66 5v10L12 22l-8.66-5V7Z" />
                        <path d="M12 2v20M3.34 7l17.32 10m0-10L3.34 17" />
                      </svg>
                      <span className="sr-only">Kite on hexly.ai (opens in a new tab)</span>
                    </a>
                  </IconButton>
                  <ThemeToggle aria-label="Change theme" />
                </>
              }
            />
            <div className="island-wrap">
              <ContentIsland id="observatory-content">
                {state.error && (
                  <Banner
                    className="collector-notice"
                    variant="error"
                    size="sm"
                    role="alert"
                    icon={<TriangleAlert />}
                    description={
                      <>
                        {state.error}. Start <code>npm start</code> to resume observation. Existing history
                        stays on this machine.
                      </>
                    }
                    action={
                      <Banner.Action onClick={onRetry}>
                        <RefreshCw />
                        Retry
                      </Banner.Action>
                    }
                  />
                )}
                {children}
              </ContentIsland>
            </div>
          </AppMain>
        </AppShell>
      </Sheet>
    </LinkProvider>
  );
}
