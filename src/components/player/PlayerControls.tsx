import type { PlayerController } from "../../features/player/controller"
import { createSignal, Show, untrack } from "solid-js"
import { IconButton } from "../ui/IconButton"
import { ControlSliderPopover } from "./ControlSliderPopover"
import { PlaybackTimeline } from "./PlaybackTimeline"
import { ProjectionSelect } from "./ProjectionSelect"
import { SettingsModal } from "./SettingsModal"

export function PlayerControls(props: { controller: PlayerController }) {
  const controller = untrack(() => props.controller)
  const [settingsOpen, setSettingsOpen] = createSignal(false)
  let adjustmentsButton!: HTMLDivElement
  const { controls, display, playback, playlist, subtitles } = controller
  const {
    controlsVisible,
    registerUiSurface,
    setControlsPanel,
    setControlsHold,
    toggleSlider,
  } = controls
  const { setPlaylistOpen, state: playlistState } = playlist
  const {
    loadingState,
    playing,
    seekBy,
    startInitialLoad,
    togglePlay,
  } = playback
  const {
    fullscreen,
    setPresetId,
    state: displayState,
    toggleFullscreen,
  } = display
  return (
    <aside
      class="player-controls pointer-events-none absolute inset-x-0 bottom-0 z-20 p-3 sm:p-6"
    >
      <div
        ref={[setControlsPanel, registerUiSurface]}
        class={`relative mx-auto grid max-w-6xl gap-3 overflow-visible rounded-[24px] bg-transparent p-2 text-white shadow-none transition-[transform,opacity] duration-300 ease-[cubic-bezier(.22,.8,.24,1)] sm:p-4 ${
          controlsVisible() ? "pointer-events-auto translate-y-0 opacity-100" : "pointer-events-none translate-y-4 opacity-0"
        }`}
        onFocusIn={(event) => {
          setControlsHold("focus", (event.target as HTMLElement).matches(":focus-visible"))
        }}
        onFocusOut={(event) => {
          if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
          setControlsHold("focus", false)
        }}
      >
        <ControlSliderPopover controller={controller} trigger={() => adjustmentsButton} />
        <div class="grid gap-3 max-sm:grid-cols-[auto_minmax(0,1fr)] max-sm:items-center max-sm:gap-x-2 max-sm:gap-y-2 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:items-center">
          <div class="flex min-w-0 items-center gap-2 overflow-x-auto overscroll-x-contain pb-0.5 [scrollbar-width:none] max-sm:col-start-1 max-sm:row-start-1 max-sm:[&::-webkit-scrollbar]:hidden">
            <IconButton
              label="Playlist"
              icon="playlist"
              pressed={playlistState.open}
              onClick={() => setPlaylistOpen(current => !current)}
            />
            <ProjectionSelect value={displayState.presetId} mount={controller.frame.getPlayer()} onChange={setPresetId} />
            <Show when={loadingState.error}>
              <button
                type="button"
                class="h-8 shrink-0 rounded-full border border-white/14 bg-white/10 px-3 text-xs font-semibold text-white/82 transition hover:bg-white/18 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70"
                onClick={startInitialLoad}
              >
                Retry
              </button>
            </Show>
          </div>

          <div class="flex items-center justify-center gap-3 justify-self-center max-sm:col-span-2 max-sm:row-start-2 max-sm:gap-5">
            <IconButton label="Seek backward" icon="rewind" onClick={() => seekBy(-10)} />
            <IconButton
              label={playing() ? "Pause" : "Play"}
              icon={playing() ? "pause" : "play"}
              iconClass={playing() ? "h-6.5 w-6.5" : "h-6.5 w-6.5 translate-x-0.5"}
              class="!h-12 !w-12 text-white/94 max-sm:!h-14 max-sm:!w-14"
              onClick={togglePlay}
            />
            <IconButton label="Seek forward" icon="fast-forward" onClick={() => seekBy(10)} />
          </div>

          <div class="flex min-w-0 items-center justify-end gap-2 overflow-x-auto overscroll-x-contain pb-0.5 [scrollbar-width:none] max-sm:col-start-2 max-sm:row-start-1 max-sm:w-full max-sm:[&::-webkit-scrollbar]:hidden sm:flex-nowrap lg:justify-end">
            <Show when={subtitles.hasSubtitle()}>
              <IconButton
                label={subtitles.enabled() ? "Hide subtitles" : "Show subtitles"}
                icon="subtitles"
                pressed={subtitles.enabled()}
                class="max-sm:hidden"
                onClick={subtitles.toggle}
              />
            </Show>
            <div ref={adjustmentsButton} class="shrink-0">
              <IconButton
                label="Adjust volume, speed, and scale"
                icon="sliders"
                onClick={() => toggleSlider("adjustments", adjustmentsButton)}
              />
            </div>

            <IconButton label="Settings" icon="settings" onClick={() => setSettingsOpen(true)} />
            <IconButton
              label={fullscreen() ? "Exit fullscreen" : "Enter fullscreen"}
              icon={fullscreen() ? "corners-in" : "corners-out"}
              pressed={fullscreen()}
              onClick={() => void toggleFullscreen()}
            />
          </div>
        </div>

        <PlaybackTimeline controller={controller} />
      </div>
      <SettingsModal
        controller={controller}
        open={settingsOpen()}
        onOpenChange={(open) => {
          setSettingsOpen(open)
          setControlsHold("settings", open)
        }}
      />
    </aside>
  )
}
