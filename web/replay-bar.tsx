import { Button, LayerCard } from "@nocoo/basalt";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nocoo/basalt/components/select";
import { Slider } from "@nocoo/basalt/components/slider";
import { ChevronLeft, ChevronRight, Clock3, Pause, Play, Radio, SkipBack, SkipForward } from "lucide-react";
import { IconButton } from "./controls.tsx";
import { duration, eventInfo } from "./model.ts";
import type { Observatory, ObservatoryState } from "./view-model.ts";

export function ReplayBar({ state, vm }: { state: ObservatoryState; vm: Observatory }) {
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
