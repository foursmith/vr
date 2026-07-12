import type { PlayerController } from "../../features/player/controller"
import type { IconName } from "../ui/Icon"
import { Portal } from "@solidjs/web"
import { createSignal, For, onSettled, Show, untrack } from "solid-js"
import { Icon } from "../ui/Icon"
import { LiquidGlass } from "../ui/LiquidGlass"

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
      aria-checked={props.pressed ? "true" : "false"}
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
          props.pressed ? "border-white/28 bg-white/24" : "border-white/12 bg-black/20"
        }`}
      >
        <span
          class={`absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white shadow-[0_1px_5px_rgba(0,0,0,.35)] transition-transform ${
            props.pressed ? "translate-x-4.5" : "translate-x-0.5"
          }`}
        >
        </span>
      </span>
    </button>
  )
}

export function SettingsModal(props: { controller: PlayerController, onClose: () => void }) {
  const controller = untrack(() => props.controller)
  const { debug, display, server } = controller
  const { setFaceAutoCenter, setSplitScreen, state } = display
  let dialog: HTMLDivElement | undefined
  const [password, setPassword] = createSignal("")

  onSettled(() => {
    dialog?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      event.preventDefault()
      props.onClose()
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
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
          class="w-full max-w-md rounded-[24px] text-white"
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
            class="max-h-[min(42rem,calc(100dvh-2rem))] w-full overflow-y-auto rounded-[inherit] bg-[#0b0c0e] outline-none"
          >
            <div class="flex items-start justify-between px-5 pb-3 pt-5">
              <div>
                <h2 id="settings-title" class="text-sm font-semibold tracking-tight text-white">Settings</h2>
                <p class="mt-1 text-[11px] text-white/46">Choose how the video view behaves.</p>
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
                title="Fill wide screens"
                description="Repeat the view side by side when the screen is wide."
                icon="columns"
                pressed={state.splitScreen}
                onClick={() => setSplitScreen(current => !current)}
              />
              <SettingToggle
                title="Follow faces"
                description="Move the view automatically to keep a detected face centered."
                icon="scan-face"
                pressed={state.faceAutoCenter}
                onClick={() => setFaceAutoCenter(current => !current)}
              />
              <SettingToggle
                title="Show debug info"
                description="Display frame rate and a preview of face tracking."
                icon="bug"
                pressed={debug.panelOpen()}
                onClick={() => debug.setPanelOpen(current => !current)}
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
            </div>
          </div>
        </LiquidGlass>
      </div>
    </Portal>
  )
}
