import type { PlayerController } from "../../features/player/controller"
import { onSettled, Show, untrack } from "solid-js"
import { IconButton } from "../ui/IconButton"

const SINGLE_CLICK_DELAY_MS = 250
const CLICK_MOVE_THRESHOLD_PX = 8

export function PlayerStage(props: { controller: PlayerController }) {
  const { controls, debug, display, frame, playback, subtitles } = untrack(() => props.controller)
  const { controlsVisible, registerUiSurface, setControlsHold } = controls
  const { faceAutoCenterPaused, handlePlayerPointerDown, handlePlayerPointerUp, projectionBoundaryWarning, resumeFaceAutoCenter, setVideo, setVrMount, setVrRoot } = frame
  let singleClickTimer: number | undefined
  let pointerStart: { id: number, x: number, y: number } | undefined
  let lastPointerType = ""
  let suppressClick = false

  const cancelSingleClick = () => {
    if (singleClickTimer === undefined) return
    window.clearTimeout(singleClickTimer)
    singleClickTimer = undefined
  }

  const handleStagePointerDown = (event: PointerEvent) => {
    handlePlayerPointerDown(event)
    lastPointerType = event.pointerType
    if (event.pointerType !== "mouse" || event.button !== 0) return
    pointerStart = { id: event.pointerId, x: event.clientX, y: event.clientY }
    suppressClick = false
  }

  const handleStagePointerUp = (event: PointerEvent) => {
    handlePlayerPointerUp(event)
    if (event.pointerType !== "mouse" || pointerStart?.id !== event.pointerId) return
    suppressClick = Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > CLICK_MOVE_THRESHOLD_PX
    pointerStart = undefined
  }

  const handleStagePointerCancel = (event: PointerEvent) => {
    handlePlayerPointerUp(event)
    if (pointerStart?.id !== event.pointerId) return
    pointerStart = undefined
    suppressClick = true
  }

  const handleStageClick = (event: MouseEvent) => {
    if (lastPointerType !== "mouse") return
    if (event.detail > 1) {
      cancelSingleClick()
      return
    }
    if (suppressClick) {
      suppressClick = false
      return
    }
    cancelSingleClick()
    singleClickTimer = window.setTimeout(() => {
      singleClickTimer = undefined
      playback.togglePlay()
    }, SINGLE_CLICK_DELAY_MS)
  }

  const handleStageDoubleClick = () => {
    if (lastPointerType !== "mouse") return
    cancelSingleClick()
    void display.toggleFullscreen()
  }

  const handleStageContextMenu = (event: MouseEvent) => {
    event.preventDefault()
    cancelSingleClick()
    playback.togglePlayAndHideControls()
  }

  onSettled(() => cancelSingleClick)

  return (
    <>
      <section
        ref={setVrRoot}
        id="vr-scene"
        class="absolute inset-0 h-dvh w-full opacity-100"
        onPointerDown={handleStagePointerDown}
        onPointerUp={handleStagePointerUp}
        onPointerCancel={handleStagePointerCancel}
        onClick={handleStageClick}
        onDblClick={handleStageDoubleClick}
        onContextMenu={handleStageContextMenu}
      >
        <div ref={setVrMount} id="vr-mount" class="h-full w-full"></div>
        <div class="pointer-events-none absolute inset-0 z-10">
          <div class="absolute right-3 top-3 flex w-[min(14rem,38vw,31.5vh)] max-w-[calc(100vw-24px)] flex-col gap-2">
            <canvas
              ref={debug.setSampleCanvas}
              id="sample-canvas"
              class="hidden aspect-[9/16] w-full object-contain overflow-hidden rounded-xl border border-accent/18 bg-[#070a0c] shadow-[0_12px_32px_rgba(0,0,0,0.34),inset_0_0_0_1px_rgba(255,255,255,0.025)]"
            >
            </canvas>
            <div
              ref={debug.setFpsMeter}
              id="fps-meter"
              class="hidden overflow-hidden rounded-xl border border-white/10 bg-[#090d0f]/88 shadow-[0_10px_28px_rgba(0,0,0,0.3)] backdrop-blur-xl"
              aria-label="Performance metrics"
            >
              <div class="flex items-center gap-2 border-b border-white/7 px-3 py-2">
                <span class="h-1.5 w-1.5 rounded-full bg-accent shadow-[0_0_8px_rgba(98,207,216,0.62)]"></span>
                <span class="text-[9px] font-semibold uppercase tracking-[0.12em] text-white/68">Tracking monitor</span>
                <span class="ml-auto font-mono text-[8px] font-semibold tracking-[0.1em] text-accent/72">LIVE</span>
              </div>
              <div data-debug-metrics class="whitespace-pre px-3 py-2.5 font-mono text-[9px] font-medium leading-[1.7] text-white/54">
                Waiting for frames…
              </div>
            </div>
          </div>
          <div
            ref={debug.setFaceHint}
            id="face-hint"
            class="absolute top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center gap-1.5 whitespace-nowrap font-mono text-[10px] font-semibold leading-none text-accent/88"
            hidden
          >
            <span data-face-horizontal-group class="hidden items-center gap-1 rounded-md bg-white/6 px-1.5 py-1.5">
              <span data-face-horizontal-icon class="text-xs text-accent"></span>
              <span data-face-horizontal-value class="tabular-nums text-white/72"></span>
            </span>
            <span data-face-vertical-group class="hidden items-center gap-1 rounded-md bg-white/6 px-1.5 py-1.5">
              <span data-face-vertical-icon class="text-xs text-accent"></span>
              <span data-face-vertical-value class="tabular-nums text-white/72"></span>
            </span>
            <span data-face-depth-group class="hidden items-center gap-1 rounded-md bg-white/6 px-1.5 py-1" aria-hidden="true">
              <span class="relative h-5 w-5 shrink-0">
                <span class="absolute inset-1 rounded-full border border-white/22"></span>
                <span data-face-depth-target class="absolute inset-1 rounded-full border border-accent/88 shadow-[0_0_8px_rgba(98,207,216,0.32)] transition-transform duration-150"></span>
              </span>
              <span data-face-depth-value class="font-mono text-[10px] font-semibold tabular-nums text-white/72"></span>
            </span>
          </div>
        </div>
      </section>

      <Show when={faceAutoCenterPaused()}>
        <div
          ref={registerUiSurface}
          data-face-centering-resume
          class={`absolute right-3 top-3 z-30 transition-[transform,opacity] duration-300 ease-[cubic-bezier(.22,.8,.24,1)] sm:right-6 sm:top-6 ${
            controlsVisible() ? "pointer-events-auto translate-x-0 opacity-100" : "pointer-events-none translate-x-[calc(100%+1.5rem)] opacity-0"
          }`}
          aria-hidden={controlsVisible() ? "false" : "true"}
          inert={!controlsVisible()}
          onFocusIn={(event) => {
            setControlsHold("focus", (event.target as HTMLElement).matches(":focus-visible"))
          }}
          onFocusOut={(event) => {
            if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
            setControlsHold("focus", false)
          }}
        >
          <IconButton
            label="Resume portrait centering"
            title="Resume portrait centering"
            icon="scan-face"
            iconClass="h-5 w-5"
            onClick={resumeFaceAutoCenter}
          />
        </div>
      </Show>

      <Show when={debug.panelOpen() && projectionBoundaryWarning()}>
        <div
          data-projection-boundary-warning
          class="pointer-events-none absolute left-1/2 top-3 z-30 -translate-x-1/2 rounded-full border border-amber-300/24 bg-amber-950/78 px-3 py-1.5 font-mono text-[10px] font-semibold tracking-[0.02em] text-amber-100/92 shadow-[0_8px_24px_rgba(0,0,0,0.28)] backdrop-blur-md sm:top-6"
          aria-live="off"
        >
          Projection boundary ·
          {` ${projectionBoundaryWarning()} (not blocked)`}
        </div>
      </Show>

      <Show when={subtitles.text()}>
        <div
          class="pointer-events-none absolute inset-x-0 bottom-[14%] z-15 flex justify-center px-[6vw] text-center"
          aria-live="off"
        >
          <p class="subtitle-cue m-0 max-w-[min(86vw,72rem)] whitespace-pre-line px-3.5 py-1.5 text-[clamp(1rem,2.2vw,1.75rem)] font-semibold leading-[1.38] text-white [text-shadow:0_1px_3px_#000]">
            {subtitles.text()}
          </p>
        </div>
      </Show>

      <video
        ref={setVideo}
        id="video"
        crossorigin="anonymous"
        playsinline
        webkit-playsinline="true"
        class="native-video absolute inset-0 hidden h-full w-full bg-black object-contain"
        onTimeUpdate={playback.syncTime}
        onLoadedMetadata={playback.syncTime}
        onPlaying={() => playback.handlePlayingChange(true)}
        onPause={() => playback.handlePlayingChange(false)}
        onEnded={playback.handlePlaybackEnded}
        onVolumeChange={playback.handleVolumeChange}
        onRateChange={playback.handlePlaybackRateChange}
      >
      </video>
    </>
  )
}
