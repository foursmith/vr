import type { PlayerController } from "../../features/player/controller"
import type { IconName } from "../ui/Icon"
import { Show, untrack } from "solid-js"
import { createPopover } from "../ui/createPopover"
import { GlassRange } from "../ui/GlassRange"
import { Icon } from "../ui/Icon"
import { LiquidGlass } from "../ui/LiquidGlass"

function HorizontalControlRange(props: {
  label: string
  valueLabel: string
  min: number
  max: number
  step: number
  value: number
  progress: number
  onInput: (value: number) => void
  actionLabel: string
  actionIcon: IconName
  actionPressed?: boolean
  onAction: () => void
}) {
  const progress = () => Math.min(100, Math.max(0, props.progress))
  return (
    <div class="grid w-full grid-cols-[3.25rem_minmax(0,1fr)_4rem] items-center gap-2 rounded-xl px-2.5 py-2 transition-colors hover:bg-white/5 focus-within:bg-white/5">
      <span class="text-[10px] font-semibold tracking-tight text-white/62">{props.label}</span>
      <GlassRange
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        progress={progress()}
        label={props.label}
        valueLabel={props.valueLabel}
        onInput={props.onInput}
      />
      <span class="flex items-center justify-end gap-1">
        <span class="text-right text-[10px] font-semibold tabular-nums text-white/46">{props.valueLabel}</span>
        <button
          type="button"
          aria-label={props.actionLabel}
          aria-pressed={props.actionPressed === undefined ? undefined : props.actionPressed ? "true" : "false"}
          title={props.actionLabel}
          class="grid h-6 w-6 shrink-0 place-items-center rounded-md border-0 bg-transparent p-0 text-white/46 transition hover:text-white"
          onClick={props.onAction}
        >
          <Icon name={props.actionIcon} class="h-3.5 w-3.5" />
        </button>
      </span>
    </div>
  )
}

export function ControlSliderPopover(props: { controller: PlayerController, trigger: () => HTMLElement | undefined }) {
  const { controls, display, playback } = untrack(() => props.controller)
  const { activeSlider, closeSlider, sliderAnchor, updateSliderAnchor } = controls
  const { resetView, setZoom, zoom } = display
  const { playbackRate, setPlaybackRateLevel, setVolumeLevel, toggleMute, volume } = playback
  const formattedRate = () => `${Number(playbackRate().toFixed(2))}×`
  let panel: HTMLElement | undefined
  createPopover({
    open: () => Boolean(activeSlider()),
    trigger: () => props.trigger(),
    panel: () => panel,
    close: closeSlider,
    updatePosition: () => {
      const trigger = props.trigger()
      if (trigger) updateSliderAnchor(trigger)
    },
  })
  return (
    <Show when={activeSlider()}>
      <LiquidGlass
        class="!absolute right-0 z-40 w-[min(18.5rem,calc(100vw-1.5rem))] rounded-2xl text-white"
        style={{ bottom: `${sliderAnchor().bottom}px` }}
        cornerRadius={16}
        elasticity={0.08}
        castShadow
      >
        <section
          ref={panel}
          aria-label="Playback adjustments"
          class="grid w-full gap-0.5 overflow-hidden rounded-2xl p-2"
          onKeyDown={(event) => {
            if (event.key === "Escape") closeSlider()
          }}
        >
          <HorizontalControlRange
            label="Volume"
            valueLabel={`${Math.round(volume() * 100)}%`}
            min={0}
            max={1}
            step={0.01}
            value={volume()}
            progress={volume() * 100}
            onInput={setVolumeLevel}
            actionLabel={volume() === 0 ? "Unmute" : "Mute"}
            actionIcon={volume() === 0 ? "volume-x" : volume() < 0.5 ? "volume-1" : "volume-2"}
            actionPressed={volume() === 0}
            onAction={toggleMute}
          />
          <HorizontalControlRange
            label="Speed"
            valueLabel={formattedRate()}
            min={0.5}
            max={2}
            step={0.05}
            value={playbackRate()}
            progress={((playbackRate() - 0.5) / 1.5) * 100}
            onInput={setPlaybackRateLevel}
            actionLabel="Reset speed"
            actionIcon="rotate-ccw"
            onAction={() => setPlaybackRateLevel(1)}
          />
          <HorizontalControlRange
            label="Zoom"
            valueLabel={`${Math.round(zoom() * 100)}%`}
            min={0.8}
            max={2.4}
            step={0.01}
            value={zoom()}
            progress={((zoom() - 0.8) / 1.6) * 100}
            onInput={setZoom}
            actionLabel="Reset zoom"
            actionIcon="rotate-ccw"
            onAction={resetView}
          />
        </section>
      </LiquidGlass>
    </Show>
  )
}
