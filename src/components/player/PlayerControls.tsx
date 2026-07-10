import { For, Show, untrack } from 'solid-js'
import { PRESETS, QUALITY_OPTIONS } from '../../features/vr/scene'
import type { PlayerController } from '../../features/player/controller'
import { Icon } from '../ui/Icon'
import { IconButton } from '../ui/IconButton'
import { LiquidGlass } from '../ui/LiquidGlass'
import { ControlSliderPopover } from './ControlSliderPopover'
import { PlaybackTimeline } from './PlaybackTimeline'

const glassPillClass = 'text-white transition hover:text-white focus-within:text-white'
const selectClass =
  'h-full min-w-0 flex-1 cursor-pointer appearance-none border-0 bg-transparent p-0 text-xs font-medium text-white outline-none'

export function PlayerControls(props: {
  controls: PlayerController['controls']
  display: PlayerController['display']
  playback: PlayerController['playback']
  playlist: PlayerController['playlist']
}) {
  const controls = untrack(() => props.controls)
  const display = untrack(() => props.display)
  const playback = untrack(() => props.playback)
  const playlist = untrack(() => props.playlist)
  const {
    activeSlider, cancelHideSlider, containsControlsPanel, controlsVisible, scheduleHideControls,
    scheduleHideSlider, setControlsPanel, setControlsZone, showControls, showSlider,
  } = controls
  const { setPlaylistOpen, state: playlistState } = playlist
  const {
    fileName, loadingState, openVideoFile, playing, seekBy, startInitialLoad, togglePlay, volume,
  } = playback
  const {
    fullscreen, setFaceAutoCenter, setPresetId, setShowDetectionPreview, setSplitScreen,
    setVideoOnly, state: displayState, toggleFullscreen, zoom,
  } = display
  return (
      <aside
        ref={setControlsZone}
        class={`pointer-events-auto absolute inset-x-0 bottom-0 z-20 p-3 transition-[padding] duration-300 sm:p-6 ${
          playlistState.open ? 'sm:pl-[20rem]' : ''
        }`}
      >
        <div
          ref={setControlsPanel}
          class={`pointer-events-auto relative mx-auto grid max-w-6xl gap-3 overflow-visible rounded-[24px] bg-transparent p-3 text-white shadow-none transition duration-300 ease-out sm:p-4 ${
            controlsVisible() ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-4 opacity-0'
          }`}
          onMouseEnter={showControls}
          onFocusIn={showControls}
          onFocusOut={(event) => {
            if (containsControlsPanel(event.relatedTarget as Node | null)) return
            if (loadingState.resourcesReady) scheduleHideControls()
          }}
        >
          <ControlSliderPopover controls={controls} display={display} playback={playback} />
          <div class="grid gap-3 max-sm:grid-cols-[minmax(0,1fr)_auto] max-sm:items-center max-sm:gap-x-3 max-sm:gap-y-2 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:items-center">
            <div class="flex min-w-0 items-center gap-2 overflow-x-auto overscroll-x-contain pb-0.5 [scrollbar-width:none] max-sm:col-start-1 max-sm:row-start-1 max-sm:[&::-webkit-scrollbar]:hidden">
              <LiquidGlass
                class={[glassPillClass, 'h-9 w-36 shrink-0 rounded-full max-sm:w-34']}
                cornerRadius={999}
                displacementScale={34}
                blurAmount={0.055}
                saturation={150}
                aberrationIntensity={2.2}
                elasticity={0.16}
                castShadow={false}
              >
                <label class="box-border flex h-full w-full min-w-0 items-center gap-2 rounded-full px-3">
                  <span class="sr-only">Projection</span>
                  <Icon name="cube-focus" class="h-4 w-4 shrink-0 text-white/78" />
                  <select
                    value={displayState.presetId}
                    class={selectClass}
                    aria-label="Projection"
                    title={`Projection: ${PRESETS[displayState.presetId]?.label ?? 'Projection'}`}
                    onChange={(event) => setPresetId(Number(event.currentTarget.value))}
                  >
                    <For each={PRESETS}>
                      {(preset, index) => (
                        <option value={index()} class="bg-[#1c1c1e] text-white">
                          {preset.label}
                        </option>
                      )}
                    </For>
                  </select>
                  <span aria-hidden="true" class="i-ph-caret-down pointer-events-none h-3.5 w-3.5 shrink-0 text-white/62"></span>
                </label>
              </LiquidGlass>
              <IconButton
                label="Playlist"
                icon="playlist"
                pressed={playlistState.open}
                onClick={() => setPlaylistOpen((current) => !current)}
              />
              <IconButton label="Open video" icon="file-video" onClick={openVideoFile} />
              <Show when={fileName()}>
                {(name) => <p class="min-w-0 truncate text-sm font-medium text-white/86 max-sm:hidden">{name()}</p>}
              </Show>
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

            <div class="flex items-center justify-center gap-3 justify-self-center max-sm:col-span-2 max-sm:row-start-2 max-sm:gap-4">
              <IconButton label="Seek backward" icon="rewind" onClick={() => seekBy(-10)} />
              <IconButton
                label={playing() ? 'Pause' : 'Play'}
                icon={playing() ? 'pause' : 'play'}
                iconClass={playing() ? 'h-6.5 w-6.5' : 'h-6.5 w-6.5 translate-x-0.5'}
                class="!h-12 !w-12 text-white/94"
                onClick={togglePlay}
              />
              <IconButton label="Seek forward" icon="fast-forward" onClick={() => seekBy(10)} />
            </div>

            <div class="flex min-w-0 items-center justify-end gap-2 overflow-x-auto overscroll-x-contain pb-0.5 [scrollbar-width:none] max-sm:col-span-2 max-sm:row-start-3 max-sm:w-full max-sm:justify-start max-sm:[&::-webkit-scrollbar]:hidden sm:flex-nowrap lg:justify-end">
              <LiquidGlass
                class={[glassPillClass, 'h-9 shrink-0 rounded-full']}
                cornerRadius={999}
                displacementScale={34}
                blurAmount={0.055}
                saturation={150}
                aberrationIntensity={2.2}
                elasticity={0.16}
                castShadow={false}
                onMouseEnter={cancelHideSlider}
                onMouseLeave={() => scheduleHideSlider()}
              >
                <div class="flex h-full items-center gap-1 px-1">
                  <button
                    type="button"
                    aria-label="Adjust quality"
                    aria-pressed={activeSlider() === 'quality' ? 'true' : 'false'}
                    title={`Quality: ${QUALITY_OPTIONS[displayState.qualityId]?.label ?? 'Quality'}`}
                    class="grid h-7 w-7 cursor-pointer place-items-center rounded-full border-0 bg-transparent p-0 text-white/92 transition hover:bg-white/8 hover:text-white active:scale-95 focus-visible:bg-white/12 focus-visible:outline-none"
                    onMouseEnter={(event) => showSlider('quality', event.currentTarget)}
                    onFocus={(event) => showSlider('quality', event.currentTarget)}
                    onClick={(event) => showSlider('quality', event.currentTarget)}
                  >
                    <Icon name="gauge" class="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    aria-label="Adjust volume"
                    aria-pressed={activeSlider() === 'volume' ? 'true' : 'false'}
                    title={`Volume: ${Math.round(volume() * 100)}%`}
                    class="grid h-7 w-7 cursor-pointer place-items-center rounded-full border-0 bg-transparent p-0 text-white/92 transition hover:bg-white/8 hover:text-white active:scale-95 focus-visible:bg-white/12 focus-visible:outline-none"
                    onMouseEnter={(event) => showSlider('volume', event.currentTarget)}
                    onFocus={(event) => showSlider('volume', event.currentTarget)}
                    onClick={(event) => showSlider('volume', event.currentTarget)}
                  >
                    <Icon name={volume() === 0 ? 'volume-x' : volume() > 0.55 ? 'volume-2' : 'volume-1'} class="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    aria-label="Adjust scale"
                    aria-pressed={activeSlider() === 'scale' ? 'true' : 'false'}
                    title={`Scale: ${Math.round(zoom() * 100)}%`}
                    class="grid h-7 w-7 cursor-pointer place-items-center rounded-full border-0 bg-transparent p-0 text-white/92 transition hover:bg-white/8 hover:text-white active:scale-95 focus-visible:bg-white/12 focus-visible:outline-none"
                    onMouseEnter={(event) => showSlider('scale', event.currentTarget)}
                    onFocus={(event) => showSlider('scale', event.currentTarget)}
                    onClick={(event) => showSlider('scale', event.currentTarget)}
                  >
                    <Icon name="scale" class="h-4 w-4" />
                  </button>
                </div>
              </LiquidGlass>

              <IconButton
                label={displayState.splitScreen ? 'Disable automatic split screen' : 'Enable automatic split screen'}
                icon="columns"
                pressed={displayState.splitScreen}
                onClick={() => setSplitScreen((current) => !current)}
              />
              <IconButton
                label={displayState.videoOnly ? 'Show panorama' : 'Show video only'}
                icon={displayState.videoOnly ? 'screen-share' : 'video'}
                pressed={displayState.videoOnly}
                onClick={() => setVideoOnly((current) => !current)}
              />
              <IconButton
                label={displayState.faceAutoCenter ? 'Stop face centering' : 'Center detected face'}
                icon="scan-face"
                pressed={displayState.faceAutoCenter}
                onClick={() => setFaceAutoCenter((current) => !current)}
              />
              <IconButton
                label={displayState.showDetectionPreview ? 'Hide detection image' : 'Show detection image'}
                icon="bug"
                pressed={displayState.showDetectionPreview}
                onClick={() => {
                  setShowDetectionPreview((current) => !current)
                  showControls()
                }}
              />
              <IconButton
                label={fullscreen() ? 'Exit fullscreen' : 'Enter fullscreen'}
                icon={fullscreen() ? 'corners-in' : 'corners-out'}
                pressed={fullscreen()}
                onClick={() => void toggleFullscreen()}
              />
            </div>
          </div>

          <PlaybackTimeline controller={playback} />
        </div>
      </aside>
  )
}
