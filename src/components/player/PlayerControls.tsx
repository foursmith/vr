import type { PlayerController } from "../../features/player/controller"
import { Portal } from "@solidjs/web"
import { createSignal, For, Show, untrack } from "solid-js"
import { QUALITY_OPTIONS } from "../../features/vr/scene"
import { Icon } from "../ui/Icon"
import { IconButton } from "../ui/IconButton"
import { LiquidGlass } from "../ui/LiquidGlass"
import { ControlSliderPopover } from "./ControlSliderPopover"
import { PlaybackTimeline } from "./PlaybackTimeline"
import { ProjectionSelect } from "./ProjectionSelect"
import { SettingsModal } from "./SettingsModal"

const glassPillClass = "text-white transition hover:text-white focus-within:text-white"
const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2] as const
const REPEAT_MODES = [
  { value: "off", label: "Once", icon: "play-once" },
  { value: "playlist", label: "Playlist", icon: "playlist-repeat" },
  { value: "folder", label: "Folder", icon: "folder-repeat" },
  { value: "file", label: "File", icon: "repeat-once" },
] as const
export function PlayerControls(props: { controller: PlayerController }) {
  const controller = untrack(() => props.controller)
  const [settingsOpen, setSettingsOpen] = createSignal(false)
  const [repeatOpen, setRepeatOpen] = createSignal(false)
  const [repeatAnchor, setRepeatAnchor] = createSignal({ x: 0, bottom: 0 })
  let repeatButton!: HTMLDivElement
  const { controls, display, playback, playlist, subtitles } = controller
  const {
    activeSlider,
    cancelHideSlider,
    controlsVisible,
    registerUiSurface,
    scheduleHideSlider,
    setControlsPanel,
    setControlsHold,
    showSlider,
  } = controls
  const { setPlaylistOpen, state: playlistState } = playlist
  const {
    loadingState,
    playbackRate,
    repeatMode,
    playing,
    seekBy,
    setPlaybackRateLevel,
    setRepeatMode,
    startInitialLoad,
    togglePlay,
    volume,
  } = playback
  const {
    fullscreen,
    setPresetId,
    state: displayState,
    toggleFullscreen,
    zoom,
  } = display
  return (
    <aside
      class="player-controls pointer-events-auto absolute inset-x-0 bottom-0 z-20 p-3 sm:p-6"
    >
      <div
        ref={[setControlsPanel, registerUiSurface]}
        class={`pointer-events-auto relative mx-auto grid max-w-6xl gap-3 overflow-visible rounded-[24px] bg-transparent p-2 text-white shadow-none transition-[transform,opacity] duration-300 ease-[cubic-bezier(.22,.8,.24,1)] sm:p-4 ${
          controlsVisible() ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-4 opacity-0"
        }`}
        onFocusIn={(event) => {
          setControlsHold("focus", (event.target as HTMLElement).matches(":focus-visible"))
        }}
        onFocusOut={(event) => {
          if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
          setControlsHold("focus", false)
        }}
      >
        <ControlSliderPopover controller={controller} />
        <div class="grid gap-3 max-sm:grid-cols-[auto_minmax(0,1fr)] max-sm:items-center max-sm:gap-x-2 max-sm:gap-y-2 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:items-center">
          <div class="flex min-w-0 items-center gap-2 overflow-x-auto overscroll-x-contain pb-0.5 [scrollbar-width:none] max-sm:col-start-1 max-sm:row-start-1 max-sm:[&::-webkit-scrollbar]:hidden">
            <IconButton
              label="Playlist"
              icon="playlist"
              pressed={playlistState.open}
              onClick={() => setPlaylistOpen(current => !current)}
            />
            <LiquidGlass
              class={[glassPillClass, "h-9 w-36 shrink-0 rounded-full max-sm:h-11 max-sm:w-28"]}
              cornerRadius={999}
              elasticity={0.16}
              castShadow={false}
            >
              <div class="box-border flex h-full w-full min-w-0 items-center rounded-full">
                <ProjectionSelect value={displayState.presetId} onChange={setPresetId} />
              </div>
            </LiquidGlass>
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
            <div ref={repeatButton} class="relative shrink-0">
              <IconButton
                label={`Playback mode: ${REPEAT_MODES.find(mode => mode.value === repeatMode())?.label}`}
                icon={REPEAT_MODES.find(mode => mode.value === repeatMode())?.icon ?? "play-once"}
                pressed={repeatOpen() || repeatMode() !== "off"}
                onClick={() => {
                  const next = !repeatOpen()
                  if (next) {
                    const bounds = repeatButton.getBoundingClientRect()
                    setRepeatAnchor({
                      x: bounds.left + bounds.width / 2,
                      bottom: window.innerHeight - bounds.top + 10,
                    })
                  }
                  setRepeatOpen(next)
                  setControlsHold("popover", next)
                }}
              />
              <Show when={repeatOpen()}>
                <Portal>
                  <LiquidGlass
                    class="!fixed z-50 w-52 rounded-2xl"
                    style={{
                      left: `clamp(0.75rem, calc(${repeatAnchor().x}px - 6.5rem), calc(100vw - 13.75rem))`,
                      bottom: `${repeatAnchor().bottom}px`,
                    }}
                    cornerRadius={16}
                    elasticity={0.08}
                    castShadow
                  >
                    <div class="grid w-full grid-cols-4 gap-1 p-1.5 text-white" role="radiogroup" aria-label="Playback mode">
                      <For each={REPEAT_MODES}>
                        {mode => (
                          <button
                            type="button"
                            role="radio"
                            aria-label={mode.label}
                            aria-checked={repeatMode() === mode.value ? "true" : "false"}
                            title={mode.label}
                            class={`grid h-12 place-items-center content-center gap-1 rounded-xl border-0 p-0 ${repeatMode() === mode.value ? "bg-white/13 text-white" : "bg-transparent text-white/48 hover:bg-white/7 hover:text-white/82"}`}
                            onClick={() => {
                              setRepeatMode(mode.value)
                              setRepeatOpen(false)
                              setControlsHold("popover", false)
                            }}
                          >
                            <Icon name={mode.icon} class="h-4.5 w-4.5" />
                            <span class="text-[8px] font-semibold leading-none">{mode.label}</span>
                          </button>
                        )}
                      </For>
                    </div>
                  </LiquidGlass>
                </Portal>
              </Show>
            </div>
            <Show when={subtitles.hasSubtitle()}>
              <IconButton
                label={subtitles.enabled() ? "Hide subtitles" : "Show subtitles"}
                icon="subtitles"
                pressed={subtitles.enabled()}
                class="max-sm:hidden"
                onClick={subtitles.toggle}
              />
            </Show>
            <LiquidGlass
              class={[glassPillClass, "h-9 w-16 shrink-0 rounded-full max-sm:h-11"]}
              cornerRadius={999}
              elasticity={0.16}
              castShadow={false}
            >
              <select
                aria-label="Playback speed"
                title={`Playback speed: ${playbackRate()}×`}
                value={playbackRate()}
                class="h-full w-full cursor-pointer appearance-none border-0 bg-transparent px-2 text-center text-xs font-semibold text-white outline-none"
                onChange={event => setPlaybackRateLevel(Number(event.currentTarget.value))}
              >
                <For each={PLAYBACK_RATES}>
                  {rate => (
                    <option value={rate} class="bg-neutral-900 text-white">
                      {rate}
                      ×
                    </option>
                  )}
                </For>
              </select>
            </LiquidGlass>
            <LiquidGlass
              class={[glassPillClass, "h-9 shrink-0 rounded-full max-sm:h-11"]}
              cornerRadius={999}
              elasticity={0.16}
              castShadow={false}
              onMouseEnter={cancelHideSlider}
              onMouseLeave={() => scheduleHideSlider()}
            >
              <div class="flex h-full items-center gap-1 px-1">
                <button
                  type="button"
                  aria-label="Adjust quality"
                  aria-pressed={activeSlider() === "quality" ? "true" : "false"}
                  title={`Quality: ${QUALITY_OPTIONS[displayState.qualityId]?.label ?? "Quality"}`}
                  class="grid h-7 w-7 place-items-center rounded-full border-0 bg-transparent p-0 text-white/92 max-sm:hidden"
                  onMouseEnter={event => showSlider("quality", event.currentTarget)}
                  onFocus={event => showSlider("quality", event.currentTarget)}
                  onClick={event => showSlider("quality", event.currentTarget)}
                >
                  <Icon name="gauge" class="h-4 w-4" />
                </button>
                <button
                  type="button"
                  aria-label="Adjust volume"
                  aria-pressed={activeSlider() === "volume" ? "true" : "false"}
                  title={`Volume: ${Math.round(volume() * 100)}%`}
                  class="grid h-7 w-7 place-items-center rounded-full border-0 bg-transparent p-0 text-white/92 max-sm:h-11 max-sm:w-11"
                  onMouseEnter={event => showSlider("volume", event.currentTarget)}
                  onFocus={event => showSlider("volume", event.currentTarget)}
                  onClick={event => showSlider("volume", event.currentTarget)}
                >
                  <Icon name={volume() === 0 ? "volume-x" : volume() > 0.55 ? "volume-2" : "volume-1"} class="h-4 w-4" />
                </button>
                <button
                  type="button"
                  aria-label="Adjust scale"
                  aria-pressed={activeSlider() === "scale" ? "true" : "false"}
                  title={`Scale: ${Math.round(zoom() * 100)}%`}
                  class="grid h-7 w-7 place-items-center rounded-full border-0 bg-transparent p-0 text-white/92 max-sm:hidden"
                  onMouseEnter={event => showSlider("scale", event.currentTarget)}
                  onFocus={event => showSlider("scale", event.currentTarget)}
                  onClick={event => showSlider("scale", event.currentTarget)}
                >
                  <Icon name="scale" class="h-4 w-4" />
                </button>
              </div>
            </LiquidGlass>

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
