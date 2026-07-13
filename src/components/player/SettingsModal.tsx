import type { PlayerController } from "../../features/player/controller"
import type { IconName } from "../ui/Icon"
import { createSignal, For, onSettled, Show, untrack } from "solid-js"
import { SHORTCUT_DEFINITIONS } from "../../features/player/shortcuts"
import { Drawer } from "../ui/Drawer"
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
  const { debug, display, server } = controller
  const { setFaceAutoCenter, setSplitScreen, state } = display
  const [password, setPassword] = createSignal("")
  const [narrowScreen, setNarrowScreen] = createSignal(window.matchMedia("(max-width: 639.9px)").matches)

  onSettled(() => {
    const media = window.matchMedia("(max-width: 639.9px)")
    const sync = () => setNarrowScreen(media.matches)
    media.addEventListener("change", sync)
    return () => media.removeEventListener("change", sync)
  })

  const content = () => (
    <div class="max-h-[calc(100dvh-1rem)] w-full overflow-y-auto pb-[env(safe-area-inset-bottom)] pt-3 overscroll-contain">
      <div class="flex items-start justify-between px-5 pb-3 pt-5">
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

        <Show when={server.state.status !== "disconnected"}>
          <section class="mt-1 overflow-hidden rounded-2xl bg-white/4" aria-labelledby="server-settings-title">
            <div class="grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-x-3 px-3 py-3">
              <span class="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-white/8 text-white/78">
                <Icon name="server" class="h-4 w-4" />
              </span>
              <div class="min-w-0 flex-1">
                <h3 id="server-settings-title" class="text-xs font-semibold text-white/92">Local media server</h3>
                <p class="mt-0.5 truncate text-[11px] text-white/48">Local files and DLNA devices</p>
              </div>
              <span class={`flex shrink-0 items-center gap-1.5 rounded-full px-2 py-1 text-[9px] font-semibold ${server.state.status === "connected" ? "bg-emerald-400/10 text-emerald-200/80" : "bg-white/6 text-white/38"}`}>
                <span class={`h-1.5 w-1.5 rounded-full ${server.state.status === "connected" ? "bg-emerald-300" : "bg-amber-200/70"}`}></span>
                {server.state.status === "authentication-required" ? "Locked" : server.state.status}
              </span>
            </div>

            <form
              class="grid grid-cols-[2rem_minmax(0,1fr)] gap-x-3 border-t border-white/7 px-3 py-2.5"
              onSubmit={(event) => {
                event.preventDefault()
                const nextPassword = password()
                setPassword("")
                void server.authenticate(nextPassword).catch(() => {})
              }}
            >
              <div class="col-start-2 flex items-center gap-2">
                <label for="fsvr-password" class="w-18 shrink-0 text-[10px] font-semibold text-white/56">Password</label>
                <div class="flex h-8 min-w-0 flex-1 overflow-hidden rounded-lg border border-white/10 bg-black/16 focus-within:border-white/24">
                  <input
                    id="fsvr-password"
                    type="password"
                    autocomplete="current-password"
                    value={password()}
                    onInput={event => setPassword(event.currentTarget.value)}
                    placeholder="Enter a new password"
                    class="h-full min-w-0 flex-1 border-0 bg-transparent px-2.5 text-[10px] text-white outline-none placeholder:text-white/24"
                  />
                  <button
                    type="submit"
                    disabled={server.state.status === "connecting" || !password()}
                    class="m-0.5 rounded-md border-0 bg-white/9 px-2.5 text-[9px] font-semibold text-white/68 transition hover:!bg-white/14 hover:text-white disabled:cursor-wait disabled:opacity-35"
                  >
                    {server.state.status === "connecting" ? "Checking…" : "Update"}
                  </button>
                </div>
              </div>
              <Show when={server.state.error}>
                {message => <p class="col-start-2 mt-2 text-[10px] text-red-300/85">{message()}</p>}
              </Show>
            </form>

            <Show when={server.state.status === "connected"}>
              <div class="grid grid-cols-[2rem_minmax(0,1fr)] gap-x-3 border-t border-white/7 px-3 py-2.5">
                <div class="col-start-2 flex items-center justify-between gap-3">
                  <div>
                    <div class="flex items-center gap-2">
                      <h4 class="text-[10px] font-semibold text-white/56">DLNA devices</h4>
                      <Show when={server.state.dlnaDevices.length}>
                        <span class="font-mono text-[9px] text-accent/70">{server.state.dlnaDevices.length}</span>
                      </Show>
                    </div>
                    <p class="mt-0.5 text-[9px] text-white/32">Visible on the server network</p>
                  </div>
                  <button
                    type="button"
                    disabled={server.state.scanningDlna}
                    class="h-7 rounded-lg border-0 bg-white/8 px-2.5 text-[9px] font-semibold text-white/62 transition hover:!bg-white/13 hover:text-white/86 disabled:cursor-wait disabled:opacity-40"
                    onClick={() => void server.scanDlna().catch(() => {})}
                  >
                    {server.state.scanningDlna ? "Scanning…" : "Scan network"}
                  </button>
                </div>
                <Show
                  when={server.state.dlnaDevices.length}
                  fallback={<p class="col-start-2 mt-2 text-[9px] text-white/28">No devices connected.</p>}
                >
                  <ul class="col-start-2 mt-2.5 divide-y divide-white/6 border-t border-white/6">
                    <For each={server.state.dlnaDevices}>
                      {device => (
                        <li class="flex h-8 items-center gap-2 text-[10px] text-white/68">
                          <span class="h-1 w-1 rounded-full bg-emerald-300/80"></span>
                          <span class="min-w-0 flex-1 truncate font-medium">{device.name}</span>
                          <span class="font-mono text-[8px] uppercase tracking-wider text-white/24">online</span>
                        </li>
                      )}
                    </For>
                  </ul>
                </Show>
              </div>
            </Show>
          </section>
        </Show>

        <Show when={!narrowScreen()}>
          <details class="group mt-1 overflow-hidden rounded-2xl bg-white/4">
            <summary class="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 marker:hidden">
              <div>
                <h3 class="text-xs font-semibold text-white/92">Keyboard shortcuts</h3>
                <p class="mt-0.5 text-[11px] text-white/48">View all player keyboard controls.</p>
              </div>
              <span aria-hidden="true" class="text-xs text-white/42 transition-transform group-open:rotate-180">⌄</span>
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
