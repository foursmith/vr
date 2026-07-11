import { Show, untrack } from 'solid-js'
import { QUALITY_OPTIONS } from '../../features/vr/scene'
import type { PlayerController } from '../../features/player/controller'
import { Icon } from '../ui/Icon'
import { LiquidGlass } from '../ui/LiquidGlass'
import { VerticalGlassRange } from '../ui/VerticalGlassRange'

const glassPillClass = 'text-white transition hover:text-white focus-within:text-white'

export function ControlSliderPopover(props: {
  controls: PlayerController['controls']
  display: PlayerController['display']
  playback: PlayerController['playback']
}) {
  const controls = untrack(() => props.controls)
  const display = untrack(() => props.display)
  const playback = untrack(() => props.playback)
  const { activeSlider, cancelHideSlider, scheduleHideSlider, sliderAnchor } = controls
  const { resetView, setQualityId, setZoom, state: displayState, zoom } = display
  const { setVolumeLevel, volume } = playback
  return (
          <Show when={activeSlider()}>
            {(control) => (
              <LiquidGlass
                class={[glassPillClass, '!absolute z-40 w-fit -translate-x-1/2 rounded-full']}
                style={{
                  left: `${sliderAnchor().x}px`,
                  bottom: `${sliderAnchor().bottom}px`,
                }}
                cornerRadius={999}
                elasticity={0.12}
                castShadow={false}
                onMouseEnter={cancelHideSlider}
                onMouseLeave={() => scheduleHideSlider()}
                onFocusIn={cancelHideSlider}
                onFocusOut={(event) => {
                  if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
                  scheduleHideSlider()
                }}
              >
                <div class="grid justify-items-center gap-2 px-2.5 py-3">
                  <Show when={control() === 'quality'}>
                    <VerticalGlassRange
                      min={0}
                      max={QUALITY_OPTIONS.length - 1}
                      step={1}
                      value={displayState.qualityId}
                      progress={(displayState.qualityId / (QUALITY_OPTIONS.length - 1)) * 100}
                      label="Quality"
                      title={`Quality: ${QUALITY_OPTIONS[displayState.qualityId]?.label ?? 'Quality'}`}
                      onInput={setQualityId}
                    />
                  </Show>
                  <Show when={control() === 'volume'}>
                    <VerticalGlassRange
                      min={0}
                      max={1}
                      step={0.01}
                      value={volume()}
                      progress={volume() * 100}
                      label="Volume"
                      onInput={setVolumeLevel}
                    />
                  </Show>
                  <Show when={control() === 'scale'}>
                    <VerticalGlassRange
                      min={0.8}
                      max={2.4}
                      step={0.01}
                      value={zoom()}
                      progress={((zoom() - 0.8) / 1.6) * 100}
                      label="Scale"
                      title={`Scale: ${Math.round(zoom() * 100)}%`}
                      onInput={setZoom}
                    />
                    <button
                      type="button"
                      aria-label="Reset scale"
                      title="Reset scale"
                      class="grid h-7 w-7 place-items-center rounded-full border-0 bg-white/8 p-0 text-white/82"
                      onClick={resetView}
                    >
                      <Icon name="rotate-ccw" class="h-4 w-4" />
                    </button>
                  </Show>
                </div>
              </LiquidGlass>
            )}
          </Show>
  )
}
