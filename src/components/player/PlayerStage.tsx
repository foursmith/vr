import type { PlayerController } from "../../features/player/controller"
import { onSettled, Show, untrack } from "solid-js"

const SINGLE_CLICK_DELAY_MS = 250
const CLICK_MOVE_THRESHOLD_PX = 8

export function PlayerStage(props: { controller: PlayerController }) {
  const { debug, display, frame, playback, subtitles } = untrack(() => props.controller)
  const { handlePlayerPointerDown, handlePlayerPointerUp, setVideo, setVrMount, setVrRoot } = frame
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
      >
        <div ref={setVrMount} id="vr-mount" class="h-full w-full"></div>
        <div class="pointer-events-none absolute inset-0 z-10">
          <div
            ref={debug.setFpsMeter}
            id="fps-meter"
            class="absolute left-3 top-3 hidden whitespace-pre rounded-md border border-white/16 bg-black/68 px-3 py-2 font-mono text-[11px] font-semibold leading-[1.55] text-white/78 shadow-[0_8px_24px_rgba(0,0,0,0.42)] backdrop-blur-md"
            aria-label="Performance metrics"
          >
            FPS --  P95 -- ms
          </div>
          <canvas
            ref={debug.setSampleCanvas}
            id="sample-canvas"
            class="absolute right-3 top-3 hidden aspect-auto w-[min(16rem,24vw)] max-w-[calc(100vw-24px)] rounded-md border border-white/22 bg-black shadow-[0_12px_34px_rgba(0,0,0,0.48),0_0_0_1px_rgba(0,0,0,0.55)]"
          >
          </canvas>
          <div
            ref={debug.setFaceHint}
            id="face-hint"
            class="absolute top-1/2 -translate-y-1/2 rounded-full border border-[#38ff8b]/44 bg-black/58 px-3 py-2.5 font-mono text-sm text-white font-extrabold leading-none shadow-[0_10px_30px_rgba(0,0,0,0.42),0_0_20px_rgba(56,255,139,0.22)] [text-shadow:0_1px_1px_rgba(0,0,0,0.55)]"
            hidden
          >
          </div>
        </div>
      </section>

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
