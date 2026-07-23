import type { PlayerController } from "../../features/player/controller"
import { createSignal, onSettled, Show, untrack } from "solid-js"
import { Icon } from "../ui/Icon"
import { IconButton } from "../ui/IconButton"
import { LiquidGlass } from "../ui/LiquidGlass"
import { SettingsModal } from "./SettingsModal"

const SINGLE_CLICK_DELAY_MS = 250
const CLICK_MOVE_THRESHOLD_PX = 8
const MAX_DEBUG_LOG_ENTRIES = 2000

export function PlayerStage(props: { controller: PlayerController }) {
  const controller = untrack(() => props.controller)
  const { controls, debug, display, frame, playback, subtitles } = controller
  const { controlsVisible, registerUiSurface, setControlsHold } = controls
  const { faceAutoCenterPaused, handlePlayerPointerDown, handlePlayerPointerUp, projectionBoundaryWarning, resumeFaceAutoCenter, setPictureInPictureContent, setVideo, setVrMount, setVrRoot } = frame
  const inPictureInPicture = display.pictureInPicture
  let singleClickTimer: number | undefined
  let pointerStart: { id: number, x: number, y: number } | undefined
  let lastPointerType = ""
  let suppressClick = false
  let stageElement!: HTMLElement
  let debugLogElement: HTMLPreElement | undefined
  let debugLogObserver: MutationObserver | undefined
  let debugLogStartedAt = 0
  let debugLogStartedOn = ""
  const debugLogEntries: string[] = []
  const [isRecordingLog, setIsRecordingLog] = createSignal(false)
  const [settingsOpen, setSettingsOpen] = createSignal(false)

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

  const schedulePlaybackToggle = (event: MouseEvent) => {
    if (event.detail > 1) {
      cancelSingleClick()
      return
    }
    cancelSingleClick()
    singleClickTimer = window.setTimeout(() => {
      singleClickTimer = undefined
      playback.togglePlay()
    }, SINGLE_CLICK_DELAY_MS)
  }

  const handleStageClick = (event: MouseEvent) => {
    if ((event.target as Element | null)?.closest("button, a, input, select, textarea")) return
    if (lastPointerType !== "mouse") return
    if (suppressClick) {
      suppressClick = false
      return
    }
    schedulePlaybackToggle(event)
  }

  const handleStageDoubleClick = () => {
    cancelSingleClick()
    if (lastPointerType !== "mouse") return
    void display.toggleFullscreen()
  }

  const handleStageContextMenu = (event: MouseEvent) => {
    event.preventDefault()
    cancelSingleClick()
    playback.togglePlayAndHideControls()
  }

  const captureDebugLogEntry = () => {
    const details = debugLogElement?.textContent?.trim()
    if (!details) return
    const elapsed = (performance.now() - debugLogStartedAt) / 1000
    debugLogEntries.push(`[+${elapsed.toFixed(3)}s]\n${details}`)
    if (debugLogEntries.length > MAX_DEBUG_LOG_ENTRIES) debugLogEntries.shift()
  }

  const stopDebugLogRecording = () => {
    debugLogObserver?.disconnect()
    debugLogObserver = undefined
    debugLogElement?.closest<HTMLElement>("#fps-meter")?.removeAttribute("data-debug-recording")
    setIsRecordingLog(false)
  }

  const startDebugLogRecording = () => {
    debugLogEntries.length = 0
    debugLogStartedAt = performance.now()
    debugLogStartedOn = new Date().toISOString()
    if (debugLogElement) debugLogElement.textContent = ""
    debugLogElement?.closest<HTMLElement>("#fps-meter")?.setAttribute("data-debug-recording", "true")
    captureDebugLogEntry()
    if (debugLogElement) {
      debugLogObserver = new MutationObserver(captureDebugLogEntry)
      debugLogObserver.observe(debugLogElement, { childList: true, characterData: true, subtree: true })
    }
    setIsRecordingLog(true)
  }

  const copyDebugLog = async () => {
    stopDebugLogRecording()
    if (debugLogEntries.length === 0) return
    const deviceNavigator = navigator as Navigator & { deviceMemory?: number }
    const log = [
      `Playback diagnostics log · ${debugLogStartedOn}`,
      `USER_AGENT ${navigator.userAgent}`,
      `DEVICE cores=${navigator.hardwareConcurrency || "--"} memory=${deviceNavigator.deviceMemory ?? "--"}GiB screen=${screen.width}×${screen.height} colorDepth=${screen.colorDepth} online=${navigator.onLine}`,
      ...debugLogEntries,
    ].join("\n\n")
    try {
      await navigator.clipboard.writeText(log)
    } catch {
      console.warn("Could not copy tracking monitor log")
    }
  }

  onSettled(() => {
    const abortController = new AbortController()
    const listenerOptions = { signal: abortController.signal }
    stageElement.addEventListener("pointerdown", handleStagePointerDown, listenerOptions)
    stageElement.addEventListener("pointerup", handleStagePointerUp, listenerOptions)
    stageElement.addEventListener("pointercancel", handleStagePointerCancel, listenerOptions)
    stageElement.addEventListener("click", handleStageClick, listenerOptions)
    return () => {
      abortController.abort()
      cancelSingleClick()
      debugLogObserver?.disconnect()
    }
  })

  return (
    <>
      <div
        ref={setPictureInPictureContent}
        class="absolute inset-0 h-full w-full overflow-hidden bg-black text-white"
      >
        <section
          ref={(element) => {
            stageElement = element
            setVrRoot(element)
          }}
          id="vr-scene"
          class="absolute inset-0 h-full w-full opacity-100"
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
                  <button
                    type="button"
                    class={[
                      "pointer-events-auto ml-auto flex items-center gap-1 rounded-md border-0 bg-white/5 px-1.5 py-1 font-mono text-[8px] font-semibold tracking-[0.04em] outline-none transition-colors hover:bg-white/10 focus-visible:ring-1 focus-visible:ring-accent/50",
                      isRecordingLog() ? "text-red-200" : "text-accent/72 hover:text-accent",
                    ]}
                    aria-label={isRecordingLog() ? "Copy tracking log and stop recording" : "Record tracking log"}
                    title={isRecordingLog() ? "Copy tracking log and stop recording" : "Record tracking log"}
                    onPointerDown={event => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation()
                      if (isRecordingLog()) void copyDebugLog()
                      else startDebugLogRecording()
                    }}
                  >
                    <Icon name={isRecordingLog() ? "copy" : "record"} class="h-2.5 w-2.5" />
                    {isRecordingLog() ? "Copy" : "Record"}
                  </button>
                </div>
                <div data-debug-metrics class="whitespace-pre px-3 py-2.5 font-mono text-[9px] font-medium leading-[1.7] text-white/54">
                  Waiting for frames…
                </div>
                <pre ref={debugLogElement} data-debug-log class="hidden" aria-hidden="true"></pre>
                <div
                  ref={debug.setFaceHint}
                  id="face-hint"
                  class="flex items-center gap-1.5 whitespace-nowrap border-t border-white/7 px-3 py-2 font-mono text-[10px] font-semibold leading-none text-accent/88"
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
                <Show when={projectionBoundaryWarning()}>
                  <div
                    data-projection-boundary-warning
                    class="border-t border-amber-300/14 bg-amber-950/36 px-3 py-2 font-mono text-[9px] font-semibold leading-[1.5] text-amber-100/86"
                    aria-live="off"
                  >
                    Projection boundary ·
                    {` ${projectionBoundaryWarning()?.source === "auto" ? "Auto" : "Manual"} ${projectionBoundaryWarning()?.axis ?? ""}`}
                  </div>
                </Show>
              </div>
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

        <Show when={inPictureInPicture() && !playback.playing()}>
          <LiquidGlass
            class="pointer-events-none !absolute left-1/2 top-1/2 z-20 h-11 w-11 -translate-x-1/2 -translate-y-1/2 rounded-full text-white/92"
            cornerRadius={999}
            elasticity={0.18}
            castShadow={false}
          >
            <Icon name="play" class="h-5 w-5 translate-x-0.5" />
          </LiquidGlass>
        </Show>
      </div>

      <Show when={inPictureInPicture()}>
        <div class="pointer-events-none absolute inset-0 grid place-items-center" aria-live="polite">
          <div class="flex items-center gap-2 rounded-full border border-white/8 bg-white/5 px-4 py-2.5 text-xs font-medium tracking-wide text-white/48">
            <Icon name="picture-in-picture" class="h-4 w-4" />
            Playing in Picture-in-Picture
          </div>
        </div>
      </Show>

      <div
        ref={registerUiSurface}
        class={[
          "absolute right-3 z-30 flex items-center gap-2 transition-[top,transform,opacity] duration-300 ease-[cubic-bezier(.22,.8,.24,1)] sm:right-6 sm:top-6",
          display.fullscreen() ? "top-12" : "top-3",
          controlsVisible() ? "pointer-events-auto translate-x-0 opacity-100" : "pointer-events-none translate-x-[calc(100%+1.5rem)] opacity-0",
        ]}
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
        <Show when={faceAutoCenterPaused()}>
          <div data-face-centering-resume class="shrink-0">
            <IconButton
              class="!h-8 !w-8 max-sm:!h-10 max-sm:!w-10"
              label="Resume portrait centering"
              title="Resume portrait centering"
              icon="scan-face"
              iconClass="h-4 w-4 max-sm:h-5 max-sm:w-5"
              onClick={resumeFaceAutoCenter}
            />
          </div>
        </Show>
        <IconButton
          class="!h-8 !w-8 max-sm:!h-10 max-sm:!w-10"
          label="Settings"
          icon="settings"
          iconClass="h-4 w-4 max-sm:h-5 max-sm:w-5"
          onClick={() => setSettingsOpen(true)}
        />
      </div>

      <SettingsModal
        controller={controller}
        open={settingsOpen()}
        onOpenChange={(open) => {
          setSettingsOpen(open)
          setControlsHold("settings", open)
        }}
      />

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
