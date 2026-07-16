import type { PlayerController } from "../../features/player/controller"
import { createSignal, For, Show, untrack } from "solid-js"
import { AB_EXPORT_FORMAT_OPTIONS, MAX_AB_EXPORT_DURATION_SECONDS } from "../../features/player/controller"
import { formatTime } from "../../lib/format-time"
import { GlassRange } from "../ui/GlassRange"
import { Icon } from "../ui/Icon"
import { ProgressTrack } from "../ui/ProgressTrack"

export function PlaybackTimeline(props: { controller: PlayerController }) {
  const controller = untrack(() => props.controller)
  const {
    currentTime,
    abLoop,
    abExport,
    abExportFormatSupported,
    clearAbLoop,
    duration,
    fileName,
    loadingPercent,
    loadingState,
    progress,
    exportAbLoop,
    seekTo,
    setAbEnd,
    setAbStart,
    startInitialLoad,
  } = controller.playback
  const { registerActivity, setControlsHold } = controller.controls
  const [hoverPreview, setHoverPreview] = createSignal<{ left: number, time: number }>()
  const [pendingTime, setPendingTime] = createSignal<number>()
  const abDuration = () => abLoop.a === undefined || abLoop.b === undefined ? 0 : abLoop.b - abLoop.a
  const abTooLong = () => abDuration() > MAX_AB_EXPORT_DURATION_SECONDS

  const timelineProgress = () => {
    const pending = pendingTime()
    const total = duration()
    return pending === undefined || !total ? progress() : (pending / total) * 100
  }

  const updateHoverPreview = (event: PointerEvent & { currentTarget: HTMLDivElement }) => {
    const total = duration()
    if (!total) {
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
    <Show
      when={loadingState.resourcesReady}
      fallback={(
        <div class="grid grid-rows-[1.35rem_1rem] gap-1 max-sm:grid-rows-[2.75rem_1rem]">
          <ProgressTrack
            progress={loadingPercent()}
            class="max-sm:h-11"
            role="progressbar"
            label="Preparing player"
          />
          <div class="flex h-4 min-w-0 items-center font-mono text-[11px] leading-4 text-white/48">
            <span class="min-w-0 truncate" role="status" aria-live="polite">{loadingState.error ?? loadingState.label}</span>
            <Show when={loadingState.error}>
              <button
                type="button"
                class="ml-2 flex h-5 shrink-0 items-center rounded-md border-0 bg-white/8 px-1.5 font-sans text-[9px] font-semibold text-white/62 transition hover:bg-white/14 hover:text-white"
                onClick={startInitialLoad}
              >
                Retry
              </button>
            </Show>
            <span class="ml-auto shrink-0 pl-3 text-right">
              {loadingPercent()}
              %
            </span>
          </div>
        </div>
      )}
    >
      <div class="grid grid-rows-[1.35rem_1rem] gap-1 max-sm:grid-rows-[2.75rem_1rem]">
        <div
          class="relative h-[1.35rem] w-full touch-none max-sm:h-11"
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
          <Show when={duration() && abLoop.a !== undefined}>
            <span class="pointer-events-none absolute top-0 z-20 h-full w-0.5 bg-amber-300/90" style={{ left: `${(abLoop.a! / duration()) * 100}%` }} aria-hidden="true"></span>
          </Show>
          <Show when={duration() && abLoop.b !== undefined}>
            <span class="pointer-events-none absolute top-0 z-20 h-full w-0.5 bg-sky-300/90" style={{ left: `${(abLoop.b! / duration()) * 100}%` }} aria-hidden="true"></span>
          </Show>
          <GlassRange
            class="absolute inset-0 max-sm:h-11"
            inputClass="cursor-default"
            min={0}
            max={duration() || 0}
            step={0.1}
            value={pendingTime() ?? currentTime()}
            progress={timelineProgress()}
            label="Playback position"
            disabled={!duration()}
            onPointerDown={() => setControlsHold("scrubbing", true)}
            onPointerUp={(pointerType) => {
              setControlsHold("scrubbing", false)
              registerActivity(pointerType === "touch" ? "touch" : "mouse")
            }}
            onPointerCancel={() => setControlsHold("scrubbing", false)}
            onInput={(value) => {
              if (!duration()) return
              setPendingTime(value)
            }}
            onChange={(value) => {
              if (!duration()) return
              seekTo(value)
              setPendingTime()
            }}
          />
        </div>
        <div class="relative flex h-4 min-w-0 items-center font-mono text-[11px] leading-4 text-white/48">
          <div class="flex min-w-0 items-center gap-1.5">
            <span class="shrink-0">{formatTime(currentTime())}</span>
            <Show when={fileName()}>
              <span class="flex shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  aria-label="Set the current position as point A"
                  class={["flex h-5 shrink-0 items-center gap-1 rounded-md px-1.5 font-mono text-[9px]", abLoop.a === undefined ? "bg-white/6 text-white/45" : "bg-amber-300/14 text-amber-200"]}
                  onClick={setAbStart}
                >
                  <span class="font-bold">A</span>
                  <Show when={abLoop.a !== undefined}>{formatTime(abLoop.a!)}</Show>
                </button>
                <Show
                  when={abLoop.a !== undefined}
                  fallback={<span class="h-px w-2 shrink-0 bg-white/15"></span>}
                >
                  <button type="button" aria-label="Clear AB loop" title="Clear AB loop" class="grid h-5 w-5 shrink-0 place-items-center rounded-full border-0 bg-transparent p-0 text-white/38 hover:bg-white/8 hover:text-white" onClick={clearAbLoop}>×</button>
                </Show>
                <button
                  type="button"
                  aria-label="Set the current position as point B"
                  disabled={abLoop.a === undefined}
                  class={["flex h-5 shrink-0 items-center gap-1 rounded-md px-1.5 font-mono text-[9px] disabled:cursor-not-allowed disabled:opacity-30", abLoop.b === undefined ? "bg-white/6 text-white/45" : "bg-sky-300/14 text-sky-200"]}
                  onClick={setAbEnd}
                >
                  <span class="font-bold">B</span>
                  <Show when={abLoop.b !== undefined}>{formatTime(abLoop.b!)}</Show>
                </button>
                <Show when={abLoop.b !== undefined}>
                  <For each={AB_EXPORT_FORMAT_OPTIONS.filter(option => abExportFormatSupported(option.value))}>
                    {option => (
                      <button
                        type="button"
                        aria-label={abTooLong() ? "AB clip is longer than 1 minute" : `Export AB clip as ${option.label}`}
                        title={abExport.format === option.value && abExport.message ? abExport.message : abTooLong() ? "Only AB clips up to 1 minute can be exported" : `Export AB clip as ${option.label}`}
                        disabled={abTooLong() || abExport.status === "recording"}
                        class={[
                          "flex h-5 shrink-0 items-center gap-1 rounded-md border-0 px-1.5 font-sans text-[9px] font-semibold transition disabled:cursor-not-allowed",
                          abTooLong() || (abExport.status === "error" && abExport.format === option.value)
                            ? "bg-red-300/12 text-red-200/80"
                            : abExport.status === "done" && abExport.format === option.value
                              ? "bg-emerald-300/14 text-emerald-200"
                              : "bg-white/8 text-white/62 hover:bg-white/14 hover:text-white",
                        ]}
                        onClick={() => void exportAbLoop(option.value)}
                      >
                        <Icon name={abExport.status === "done" && abExport.format === option.value ? "check" : "download"} class="h-3 w-3" />
                        <span>{abExport.status === "recording" && abExport.format === option.value ? `${abExport.progress}%` : abTooLong() ? "1:00 max" : option.label}</span>
                      </button>
                    )}
                  </For>
                </Show>
              </span>
            </Show>
          </div>
          <span class="ml-auto shrink-0 text-right">{formatTime(duration())}</span>
          <span class="sr-only" role="status" aria-live="polite">{abExport.message}</span>
        </div>
      </div>
    </Show>
  )
}
