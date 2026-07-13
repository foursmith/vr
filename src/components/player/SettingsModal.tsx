import type { PlayerController } from "../../features/player/controller"
import type { IconName } from "../ui/Icon"
import { createSignal, For, onSettled, Show, untrack } from "solid-js"
import appPackage from "../../../package.json"
import { SHORTCUT_DEFINITIONS } from "../../features/player/shortcuts"
import { Drawer } from "../ui/Drawer"
import { FsvrLogo } from "../ui/FsvrLogo"
import { Icon } from "../ui/Icon"
import { Modal } from "../ui/Modal"
import { Switch } from "../ui/Switch"

function SettingToggle(props: {
  title: string
  description: string
  icon: IconName
  pressed: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  return (
    <div
      class="group grid w-full cursor-pointer grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-3 rounded-2xl bg-white/4 py-1 pl-3 pr-1 text-left text-white transition-[transform,background-color] hover:bg-white/8 active:scale-[0.992]"
      onClick={(event) => {
        if ((event.target as Element).closest("button")) return
        props.onCheckedChange(!props.pressed)
      }}
    >
      <span class="grid h-8 w-8 place-items-center rounded-xl bg-white/8 text-white/78 transition group-hover:text-white">
        <Icon name={props.icon} class="h-4 w-4" />
      </span>
      <span class="min-w-0">
        <span class="block text-xs font-semibold text-white/92">{props.title}</span>
        <span class="mt-0.5 block text-[11px] leading-snug text-white/48">{props.description}</span>
      </span>
      <Switch checked={props.pressed} label={props.title} onCheckedChange={props.onCheckedChange} />
    </div>
  )
}

export function SettingsModal(props: { controller: PlayerController, open: boolean, onOpenChange: (open: boolean) => void }) {
  const controller = untrack(() => props.controller)
  const { debug, display } = controller
  const { setFaceAutoCenter, setSplitScreen, state } = display
  const [narrowScreen, setNarrowScreen] = createSignal(window.matchMedia("(max-width: 639.9px)").matches)

  onSettled(() => {
    const media = window.matchMedia("(max-width: 639.9px)")
    const sync = () => setNarrowScreen(media.matches)
    media.addEventListener("change", sync)
    return () => media.removeEventListener("change", sync)
  })

  const content = () => (
    <div class="max-h-[calc(100dvh-1rem)] w-full overflow-y-auto pb-[env(safe-area-inset-bottom)] pt-3 overscroll-contain">
      <div class="flex items-start justify-between px-5 py-3">
        <div>
          <h2 id="settings-title" class="text-sm font-semibold tracking-tight text-white">Settings</h2>
          <p id="settings-description" class="mt-1 text-[11px] text-white/46">Choose how the video view behaves.</p>
        </div>
        <button
          type="button"
          aria-label="Close settings"
          class="grid h-8 w-8 place-items-center rounded-full border-0 bg-white/7 text-white/68 outline-none transition hover:!bg-white/12 hover:text-white focus-visible:!bg-white/14 max-sm:h-11 max-sm:w-11"
          onClick={() => props.onOpenChange(false)}
        >
          <Icon name="x" class="h-4 w-4" />
        </button>
      </div>

      <div class="grid gap-1.5 px-2.5 pb-2.5">
        <SettingToggle
          title="Fill wide screens"
          description="Repeat the view side by side when the screen is wide."
          icon="columns"
          pressed={state.splitScreen}
          onCheckedChange={setSplitScreen}
        />
        <SettingToggle
          title="Follow face"
          description="Move the view automatically to keep a detected face centered."
          icon="scan-face"
          pressed={state.faceAutoCenter}
          onCheckedChange={setFaceAutoCenter}
        />
        <SettingToggle
          title="Show debug info"
          description="Display frame rate and a preview of face tracking."
          icon="bug"
          pressed={debug.panelOpen()}
          onCheckedChange={debug.setPanelOpen}
        />

        <Show when={!narrowScreen()}>
          <details class="group overflow-hidden rounded-2xl bg-white/4">
            <summary class="grid min-h-13 cursor-pointer list-none grid-cols-[2rem_minmax(0,1fr)_2rem] items-center gap-3 py-1 pl-3 pr-1 text-left transition-colors marker:hidden hover:bg-white/8">
              <span class="grid h-8 w-8 place-items-center rounded-xl bg-white/8 text-white/78 transition group-hover:text-white">
                <Icon name="keyboard" class="h-4 w-4" />
              </span>
              <div class="min-w-0">
                <h3 class="text-xs font-semibold text-white/92">Keyboard shortcuts</h3>
                <span class="mt-0.5 block text-[11px] leading-snug text-white/48">View all player keyboard controls.</span>
              </div>
              <span class="grid h-8 w-8 place-items-center text-white/42 transition-colors group-hover:text-white/68">
                <Icon name="caret-down" class="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
              </span>
            </summary>
            <div class="grid grid-cols-2 gap-x-4 border-t border-white/7 px-4 py-2">
              <For each={SHORTCUT_DEFINITIONS}>
                {shortcut => (
                  <div class="flex min-w-0 items-center justify-between gap-2 border-b border-white/6 py-2 last:border-b-0">
                    <span class="min-w-0 truncate text-[10px] font-medium text-white/66">{shortcut.label}</span>
                    <kbd class="min-w-5 shrink-0 rounded-md border border-white/9 bg-black/14 px-1.5 py-1 text-center font-mono text-[9px] font-semibold text-white/72">{shortcut.key}</kbd>
                  </div>
                )}
              </For>
            </div>
          </details>
        </Show>

        <section class="overflow-hidden rounded-2xl bg-white/4" aria-labelledby="about-title">
          <div class="grid grid-cols-[2.5rem_minmax(0,1fr)] items-center gap-3 px-3 py-3">
            <span class="grid h-10 w-10 place-items-center rounded-xl bg-white/8 shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]">
              <FsvrLogo class="h-8 w-8" />
            </span>
            <div class="min-w-0">
              <div class="flex items-center gap-2">
                <h3 id="about-title" class="text-xs font-semibold text-white/94">Foursmith VR</h3>
                <span class="rounded-full bg-white/7 px-1.5 py-0.5 font-mono text-[8px] text-white/38">
                  v
                  {appPackage.version}
                </span>
              </div>
              <p class="mt-1 text-[11px] leading-snug text-white/48">Watch VR like TikTok — no headset required.</p>
            </div>
          </div>
          <div class="flex items-center gap-2 border-t border-white/7 px-3 py-2.5 text-[10px]">
            <div class="flex min-w-0 items-center gap-2 text-white/42">
              <span class="whitespace-nowrap">
                By
                {" "}
                <a class="font-medium text-white/68 transition-colors hover:text-white focus-visible:text-white focus-visible:outline-none focus-visible:underline" href="https://github.com/ourongxing" target="_blank" rel="noreferrer">ourongxing</a>
              </span>
              <span aria-hidden="true" class="h-0.5 w-0.5 shrink-0 rounded-full bg-white/24"></span>
              <a class="whitespace-nowrap transition-colors hover:text-white/72 focus-visible:text-white/72 focus-visible:outline-none focus-visible:underline" href="https://github.com/foursmith/vr/blob/main/LICENSE" target="_blank" rel="noreferrer">{appPackage.license.replace("-", " ")}</a>
            </div>
            <a class="ml-auto flex shrink-0 items-center gap-1.5 rounded-lg px-1.5 py-1 font-medium text-white/58 transition-colors hover:bg-white/7 hover:text-white focus-visible:bg-white/7 focus-visible:text-white focus-visible:outline-none" href="https://github.com/foursmith/vr" target="_blank" rel="noreferrer">
              <Icon name="github" class="h-3.5 w-3.5" />
              GitHub
            </a>
          </div>
        </section>
      </div>
    </div>
  )

  return (
    <Show
      when={narrowScreen()}
      fallback={(
        <Modal
          open={props.open}
          titleId="settings-title"
          descriptionId="settings-description"
          onOpenChange={props.onOpenChange}
        >
          {content()}
        </Modal>
      )}
    >
      <Drawer
        open={props.open}
        titleId="settings-title"
        descriptionId="settings-description"
        onOpenChange={props.onOpenChange}
      >
        {content()}
      </Drawer>
    </Show>
  )
}
