import { onSettled, untrack } from 'solid-js'
import { Portal } from '@solidjs/web'
import type { PlayerController } from '../../features/player/controller'
import { Icon, type IconName } from '../ui/Icon'
import { LiquidGlass } from '../ui/LiquidGlass'

function SettingToggle(props: {
  title: string
  description: string
  icon: IconName
  pressed: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={props.pressed ? 'true' : 'false'}
      class="group grid w-full grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-3 rounded-2xl border-0 bg-white/4 px-3 py-3 text-left text-white outline-none transition hover:!bg-white/8 focus-visible:!bg-white/10"
      onClick={props.onClick}
    >
      <span class="grid h-8 w-8 place-items-center rounded-xl bg-white/8 text-white/78 transition group-hover:text-white">
        <Icon name={props.icon} class="h-4 w-4" />
      </span>
      <span class="min-w-0">
        <span class="block text-xs font-semibold text-white/92">{props.title}</span>
        <span class="mt-0.5 block text-[11px] leading-snug text-white/48">{props.description}</span>
      </span>
      <span
        aria-hidden="true"
        class={`relative h-5 w-9 rounded-full border transition-colors ${
          props.pressed ? 'border-white/28 bg-white/24' : 'border-white/12 bg-black/20'
        }`}
      >
        <span
          class={`absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white shadow-[0_1px_5px_rgba(0,0,0,.35)] transition-transform ${
            props.pressed ? 'translate-x-4.5' : 'translate-x-0.5'
          }`}
        ></span>
      </span>
    </button>
  )
}

export function SettingsModal(props: { controller: PlayerController; onClose: () => void }) {
  const controller = untrack(() => props.controller)
  const { debug, display } = controller
  const { setFaceAutoCenter, setSplitScreen, setVideoOnly, state } = display
  let dialog: HTMLDivElement | undefined

  onSettled(() => {
    dialog?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      props.onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  })

  return (
    <Portal>
      <div
        class="fixed inset-0 z-60 grid place-items-center p-4"
        onPointerDown={(event) => {
          if (event.target === event.currentTarget) props.onClose()
        }}
      >
        <LiquidGlass
          class="w-full max-w-sm rounded-[24px] text-white"
          cornerRadius={24}
          elasticity={0}
          castShadow
        >
          <div
            ref={dialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-title"
            tabindex="-1"
            class="w-full rounded-[inherit] bg-[#0b0c0e] outline-none"
          >
            <div class="flex items-start justify-between px-5 pb-3 pt-5">
              <div>
                <h2 id="settings-title" class="text-sm font-semibold tracking-tight text-white">Settings</h2>
                <p class="mt-1 text-[11px] text-white/46">Fine-tune how the panorama behaves.</p>
              </div>
              <button
                type="button"
                aria-label="Close settings"
                class="grid h-8 w-8 place-items-center rounded-full border-0 bg-white/7 text-white/68 outline-none transition hover:!bg-white/12 hover:text-white focus-visible:!bg-white/14"
                onClick={props.onClose}
              >
                <Icon name="x" class="h-4 w-4" />
              </button>
            </div>

            <div class="grid gap-1.5 px-2.5 pb-2.5">
              <SettingToggle
                title="Automatic split screen"
                description="Choose a split layout when the format supports it."
                icon="columns"
                pressed={state.splitScreen}
                onClick={() => setSplitScreen((current) => !current)}
              />
              <SettingToggle
                title="Video only"
                description="Hide the panorama renderer and show the source video."
                icon={state.videoOnly ? 'screen-share' : 'video'}
                pressed={state.videoOnly}
                onClick={() => setVideoOnly((current) => !current)}
              />
              <SettingToggle
                title="Face centering"
                description="Keep the detected face near the center of the view."
                icon="scan-face"
                pressed={state.faceAutoCenter}
                onClick={() => setFaceAutoCenter((current) => !current)}
              />
              <SettingToggle
                title="Debug panel"
                description="Show rendering and face-detection diagnostics."
                icon="bug"
                pressed={debug.panelOpen()}
                onClick={() => debug.setPanelOpen((current) => !current)}
              />
            </div>
          </div>
        </LiquidGlass>
      </div>
    </Portal>
  )
}
