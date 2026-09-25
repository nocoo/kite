import { Badge, Button, Input, LayerCard } from "@nocoo/basalt";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@nocoo/basalt/components/accordion";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@nocoo/basalt/components/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@nocoo/basalt/components/tabs";
import { ArrowUpRight, Search, X } from "lucide-react";
import { useMemo } from "react";
import type { StoredEvent } from "../src/store.ts";
import { moduleIcons, ToolStages } from "./execution-map.tsx";
import { duration, eventInfo, filteredEvents, type Projection } from "./model.ts";
import type { Observatory, ObservatoryState } from "./view-model.ts";

export type EvidenceTab = "events" | "payload" | "tools" | "response";

export function EventFacts({ event }: { event: StoredEvent | undefined }) {
  if (!event) return <p className="empty-copy">No observation at this step.</p>;
  const info = eventInfo(event);
  return (
    <div className={`event-facts phase-${info.module}`}>
      <Badge variant="outline">
        {info.module} · #{event.seq}
      </Badge>
      <h3>{info.label}</h3>
      <p>{info.description}</p>
      <dl className="fact-grid">
        <div>
          <dt>Hook</dt>
          <dd className="mono">{event.name}</dd>
        </div>
        <div>
          <dt>Observed at</dt>
          <dd className="mono">{new Date(event.timestamp).toLocaleTimeString()}</dd>
        </div>
        <div>
          <dt>Run</dt>
          <dd className="mono">
            {String(event.correlation?.runId ?? "—")
              .split(":")
              .at(-1)}
          </dd>
        </div>
        <div>
          <dt>Turn</dt>
          <dd className="mono">{event.correlation?.turnIndex ?? "—"}</dd>
        </div>
      </dl>
      <Accordion type="single" collapsible defaultValue="payload" className="payload">
        <AccordionItem value="payload">
          <AccordionTrigger>Captured payload</AccordionTrigger>
          <AccordionContent>
            <pre>{JSON.stringify(event.payload, null, 2)}</pre>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}

export function EventButton({
  event,
  current,
  onClick,
}: {
  event: StoredEvent;
  current: boolean;
  onClick: () => void;
}) {
  const info = eventInfo(event),
    Icon = moduleIcons[info.module];
  return (
    <Button
      variant="ghost"
      className={`event-row phase-${info.module} ${current ? "selected" : ""}`}
      onClick={onClick}
    >
      <span className="event-icon">
        <Icon />
      </span>
      <span className="event-copy">
        <strong>{info.label}</strong>
        <small className="mono">{event.name}</small>
      </span>
      <span className="event-seq mono">#{event.seq}</span>
    </Button>
  );
}

export function EvidencePanel({
  tab,
  onTab,
  onClose,
  returnFocus,
  vm,
  state,
  projection,
}: {
  tab: EvidenceTab | null;
  onTab: (tab: EvidenceTab) => void;
  onClose: () => void;
  returnFocus: () => void;
  vm: Observatory;
  state: ObservatoryState;
  projection: Projection;
}) {
  const current = state.events[state.index];
  const events = useMemo(
    () => filteredEvents(state.events.slice(0, state.index + 1), state.filter, state.search).reverse(),
    [state.events, state.index, state.filter, state.search],
  );
  return (
    <Sheet
      open={tab !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent
        className="kite-shell evidence-sheet"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocus();
        }}
      >
        <SheetTitle>Execution evidence</SheetTitle>
        <SheetDescription>
          {state.selected?.cwd || "Choose a recording to inspect captured events."}
        </SheetDescription>
        {state.selected && (
          <Accordion type="single" collapsible className="recording-facts">
            <AccordionItem value="identity">
              <AccordionTrigger>Recording identity</AccordionTrigger>
              <AccordionContent>
                <dl className="fact-grid">
                  <div>
                    <dt>Session</dt>
                    <dd className="mono">{state.selected.sessionId || "Unassigned"}</dd>
                  </div>
                  <div>
                    <dt>Recording</dt>
                    <dd className="mono">{state.selected.producerId}</dd>
                  </div>
                  <div>
                    <dt>Provider</dt>
                    <dd>{state.selected.provider || "Not observed"}</dd>
                  </div>
                  <div>
                    <dt>Model</dt>
                    <dd>{state.selected.model || "Not observed"}</dd>
                  </div>
                </dl>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        )}
        <div className="evidence-scope mono">
          Segment {state.page + 1} · {state.index + 1} / {state.events.length} observations
        </div>
        <Tabs
          value={tab ?? "events"}
          onValueChange={(value) => onTab(value as EvidenceTab)}
          className="evidence-tabs"
        >
          <TabsList>
            <TabsTrigger value="events">Timeline</TabsTrigger>
            <TabsTrigger value="payload">Observation</TabsTrigger>
            <TabsTrigger value="tools">Tools</TabsTrigger>
            <TabsTrigger value="response">Response</TabsTrigger>
          </TabsList>
          <TabsContent value="events" className="evidence-tab-body">
            <div className="timeline-search">
              <Search />
              <Input
                aria-label="Search events"
                placeholder="Hook or payload content…"
                value={state.search}
                onChange={(event) => vm.setSearch(event.target.value)}
              />
            </div>
            {state.filter !== "all" && (
              <Button variant="ghost" size="sm" onClick={() => vm.setFilter("all")}>
                {state.filter}
                <X />
              </Button>
            )}
            <p className="small muted">
              {events.length} observations through the current step. Select a step to move the map.
            </p>
            <div className="event-list">
              {events.map((event) => (
                <EventButton
                  key={event.cursor}
                  event={event}
                  current={event.cursor === current?.cursor}
                  onClick={() => {
                    vm.seek(state.events.findIndex((item) => item.cursor === event.cursor));
                    onTab("payload");
                  }}
                />
              ))}
            </div>
            {events.length === 0 && <p className="empty-copy">No matching observations at this step.</p>}
          </TabsContent>
          <TabsContent value="payload" className="evidence-tab-body">
            <EventFacts event={current} />
          </TabsContent>
          <TabsContent value="tools" className="evidence-tab-body">
            <p className="small muted">A start is an attempt. Unlit stages were not observed.</p>
            {projection.tools.map((tool) => (
              <LayerCard key={tool.id} className={`evidence-tool phase-tools tool-${tool.status}`}>
                <div className="row">
                  <strong>{tool.name}</strong>
                  <Badge variant={tool.status === "error" ? "error" : "secondary"}>{tool.status}</Badge>
                  <span className="mono small">
                    {tool.start === undefined || tool.end === undefined
                      ? "—"
                      : duration(tool.end - tool.start)}
                  </span>
                </div>
                <p className="mono small muted">{tool.id}</p>
                <ToolStages tool={tool} />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    vm.seek(state.events.findIndex((event) => event.cursor === tool.cursor));
                    onTab("payload");
                  }}
                >
                  Inspect latest hook
                  <ArrowUpRight />
                </Button>
              </LayerCard>
            ))}
            {projection.tools.length === 0 && (
              <p className="empty-copy">No tool attempt observed in this segment.</p>
            )}
          </TabsContent>
          <TabsContent value="response" className="evidence-tab-body">
            <p className="small muted">
              {projection.tokens.toLocaleString()} observed tokens · {projection.chunks} stream chunks in this
              segment
            </p>
            <h3>Latest assistant message</h3>
            <pre className="response-text">
              {projection.text || "No assistant text observed in this segment."}
            </pre>
            <Accordion type="single" collapsible>
              <AccordionItem value="thinking">
                <AccordionTrigger>Provider-exposed thinking</AccordionTrigger>
                <AccordionContent>
                  <pre>{projection.thinking || "No thinking content observed."}</pre>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </TabsContent>
        </Tabs>
        <p className="evidence-limit">
          Up to 500 events per segment. Earlier context may be outside this segment. Original payloads
          preserve capture limits.
        </p>
      </SheetContent>
    </Sheet>
  );
}
