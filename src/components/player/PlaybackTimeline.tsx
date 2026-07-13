import type { PlayerController } from "../../features/player/controller"
import { createSignal, Show, untrack } from "solid-js"
import { formatTime } from "../../lib/format-time"
import { LiquidGlass } from "../ui/LiquidGlass"

export function PlaybackTimeline(props: { controller: PlayerController }) {
  const controller = untrack(() => props.controller)
  const {
    currentTime,
    abLoop,
    clearAbLoop,
    duration,
    fileName,
    loadingPercent,
    loadingState,
    progress,
    seekTo,
    setAbEnd,
    setAbStart,
  } = controller.playback
  const { registerActivity, setControlsHold } = controller.controls
  const [hoverPreview, setHoverPreview] = createSignal<{ left: number, time: number }>()
  const [pendingTime, setPendingTime] = createSignal<number>()

  const timelineProgress = () => {
    const pending = pendingTime()
    const total = duration()
    return pending === undefined || !total ? progress() : (pending / total) * 100
  }

  const updateHoverPreview = (event: PointerEvent & { currentTarget: HTMLDivElement }) => {
    const total = duration()
    if (!loadingState.resourcesReady || !total) {
      setHoverPreview()
      return
    }

    const bounds = event.currentTarget.getBoundingClientRect()
    const position = Math.min(bounds.width, Math.max(0, event.clientX - bounds.left))
    const ratio = bounds.width ? position / bounds.width : 0

    setHoverPreview({
      left: position,
      time: ratio * total,
    })
  }

  return (
    <div
      class="grid grid-rows-[1.35rem_1rem] gap-1 max-sm:grid-rows-[2.75rem_1rem]"
      role={loadingState.resourcesReady ? undefined : "status"}
      aria-live={loadingState.resourcesReady ? undefined : "polite"}
    >
      <div
        class="relative h-[1.35rem] w-full touch-none [--fill:rgba(255,255,255,0.82)] [--track:rgba(255,255,255,0.18)] max-sm:h-11"
        style={`--progress:${loadingState.resourcesReady ? timelineProgress() : loadingPercent()}%`}
        onPointerMove={updateHoverPreview}
        onPointerLeave={() => setHoverPreview()}
      >
        <Show when={hoverPreview()}>
          {preview => (
            <span
              aria-hidden="true"
              class="pointer-events-none absolute bottom-full left-0 z-30 font-mono text-[11px] leading-4 text-white/48 will-change-transform"
              style={{ transform: `translate3d(${preview().left}px, 0, 0) translateX(-50%)` }}
            >
              {formatTime(preview().time)}
            </span>
          )}
        </Show>
        <span
          aria-hidden="true"
          class="pointer-events-none absolute inset-x-0 top-1/2 h-[0.28rem] -translate-y-1/2 overflow-hidden rounded-full"
          style={{ background: "var(--track)" }}
        >
          <span class="block h-full rounded-full" style={{ width: "var(--progress)", background: "var(--fill)" }}></span>
        </span>
        <Show when={loadingState.resourcesReady && duration() && abLoop.a !== undefined}>
          <span class="pointer-events-none absolute top-0 z-20 h-full w-0.5 bg-amber-300/90" style={{ left: `${(abLoop.a! / duration()) * 100}%` }} aria-hidden="true"></span>
        </Show>
        <Show when={loadingState.resourcesReady && duration() && abLoop.b !== undefined}>
          <span class="pointer-events-none absolute top-0 z-20 h-full w-0.5 bg-sky-300/90" style={{ left: `${(abLoop.b! / duration()) * 100}%` }} aria-hidden="true"></span>
        </Show>
        <input
          type="range"
          min="0"
          max={loadingState.resourcesReady ? duration() || 0 : 100}
          step={loadingState.resourcesReady ? "0.1" : "1"}
          value={loadingState.resourcesReady ? pendingTime() ?? currentTime() : loadingPercent()}
          aria-label={loadingState.resourcesReady ? "Playback position" : "Loading progress"}
          disabled={!loadingState.resourcesReady}
          class="media-range absolute inset-0 z-10 h-[1.35rem] w-full cursor-default appearance-none bg-transparent max-sm:h-11"
          onPointerDown={() => setControlsHold("scrubbing", true)}
          onPointerUp={(event) => {
            setControlsHold("scrubbing", false)
            registerActivity(event.pointerType === "touch" ? "touch" : "mouse")
          }}
          onPointerCancel={() => setControlsHold("scrubbing", false)}
          onInput={(event) => {
            if (!loadingState.resourcesReady) return
            if (!duration()) return
            setPendingTime(Number(event.currentTarget.value))
          }}
          onChange={(event) => {
            if (!loadingState.resourcesReady) return
            if (!duration()) return
            seekTo(Number(event.currentTarget.value))
            setPendingTime()
          }}
        />
        <Show when={loadingState.resourcesReady}>
          <LiquidGlass
            class="liquid-glass-range-thumb pointer-events-none !absolute z-20 h-4 w-4 rounded-full"
            style={{
              left: "calc(var(--progress) - 0.5rem)",
              top: "calc(50% - 0.5rem)",
            }}
            cornerRadius={999}
            elasticity={0}
            active
            castShadow={false}
          >
            <span
              aria-hidden="true"
              class="block h-full w-full rounded-full border border-white/34 bg-[linear-gradient(145deg,rgba(255,255,255,0.26),rgba(255,255,255,0.12))] shadow-[inset_0_1px_1px_rgba(255,255,255,0.68),0_2px_8px_rgba(0,0,0,0.24)]"
            >
            </span>
          </LiquidGlass>
        </Show>
      </div>
      <div class="grid h-4 min-w-0 grid-cols-[1fr_minmax(0,2fr)_1fr] items-center font-mono text-[11px] leading-4 text-white/48">
        <span class="col-start-1 min-w-0 truncate">{loadingState.resourcesReady ? formatTime(currentTime()) : loadingState.error ?? loadingState.label}</span>
        <Show when={fileName()}>
          {name => (
            <span class="col-start-2 flex min-w-0 items-center justify-center gap-1.5 px-3 text-center font-sans font-medium text-white/70">
              <button
                type="button"
                aria-label="将当前位置设为 A 点"
                class={`flex h-5 shrink-0 items-center gap-1 rounded-md px-1.5 font-mono text-[9px] ${abLoop.a === undefined ? "bg-white/6 text-white/45" : "bg-amber-300/14 text-amber-200"}`}
                onClick={setAbStart}
              >
                <span class="font-bold">A</span>
                <Show when={abLoop.a !== undefined}>{formatTime(abLoop.a!)}</Show>
              </button>
              <Show
                when={abLoop.a !== undefined}
                fallback={<span class="h-px w-2 shrink-0 bg-white/15"></span>}
              >
                <button type="button" aria-label="清除 AB 循环" title="清除 AB 循环" class="grid h-5 w-5 shrink-0 place-items-center rounded-full border-0 bg-transparent p-0 text-white/38 hover:bg-white/8 hover:text-white" onClick={clearAbLoop}>×</button>
              </Show>
              <button
                type="button"
                aria-label="将当前位置设为 B 点"
                disabled={abLoop.a === undefined}
                class={`flex h-5 shrink-0 items-center gap-1 rounded-md px-1.5 font-mono text-[9px] disabled:cursor-not-allowed disabled:opacity-30 ${abLoop.b === undefined ? "bg-white/6 text-white/45" : "bg-sky-300/14 text-sky-200"}`}
                onClick={setAbEnd}
              >
                <span class="font-bold">B</span>
                <Show when={abLoop.b !== undefined}>{formatTime(abLoop.b!)}</Show>
              </button>
              <span class="min-w-0 truncate">{name()}</span>
            </span>
          )}
        </Show>
        <span class="col-start-3 min-w-0 truncate text-right">{loadingState.resourcesReady ? formatTime(duration()) : `${loadingPercent()}%`}</span>
      </div>
    </div>
  )
}
