import { createSignal, Show } from "solid-js"
import { isChromiumBrowser } from "../../lib/browser"
import { BrowserCompatibilityNotice } from "../BrowserCompatibilityNotice"
import { FsvrLogo } from "../ui/FsvrLogo"
import { Icon } from "../ui/Icon"
import { LiquidGlass } from "../ui/LiquidGlass"
import { MediaPickerButtons } from "../ui/MediaPickerButtons"
import { OceanBackground } from "./OceanBackground"

type ServerStatus = "disconnected" | "connecting" | "authentication-required" | "connected" | "error"

export function EmptyState(props: {
  serverStatus: ServerStatus
  serverError?: string
  onAuthenticate: (password: string) => Promise<void>
  onChooseFiles: () => void
  onChooseFolder: () => void
}) {
  const [password, setPassword] = createSignal("")
  let passwordInput: HTMLInputElement | undefined

  const submitPassword = async (event: SubmitEvent) => {
    event.preventDefault()
    const value = password()
    if (!value.trim() || props.serverStatus === "connecting") return
    try {
      await props.onAuthenticate(value)
      setPassword("")
    } catch {
      // The controller exposes the authentication error in the empty state.
      queueMicrotask(() => passwordInput?.focus())
    }
  }

  return (
    <section class="empty-state-bg absolute inset-0 z-10 flex items-center justify-center overflow-hidden px-5 py-8 text-center text-white sm:px-10 sm:py-12">
      <OceanBackground />
      <div class="empty-state-content relative z-10 flex flex-col items-center gap-3 sm:gap-4">
        <div class="relative h-60 w-88 sm:h-68 sm:w-100">
          <svg aria-hidden="true" viewBox="0 0 240 240" class="empty-depth-rings absolute left-1/2 top-1/2 h-58 w-58 overflow-visible sm:h-68 sm:w-68">
            <defs>
              <linearGradient id="depth-ring-inner" x1="52" y1="42" x2="186" y2="194" gradientUnits="userSpaceOnUse">
                <stop offset="0" stop-color="#f5fffc" stop-opacity="0.12" />
                <stop offset="0.42" stop-color="currentColor" stop-opacity="0.62" class="text-accent" />
                <stop offset="1" stop-color="#62cfd8" stop-opacity="0.16" />
              </linearGradient>
              <linearGradient id="depth-ring-outer" x1="32" y1="24" x2="208" y2="216" gradientUnits="userSpaceOnUse">
                <stop offset="0" stop-color="currentColor" stop-opacity="0.04" class="text-accent" />
                <stop offset="0.56" stop-color="#62cfd8" stop-opacity="0.24" />
                <stop offset="1" stop-color="#62cfd8" stop-opacity="0.02" />
              </linearGradient>
            </defs>
            <circle cx="120" cy="120" r="72" fill="none" stroke="url(#depth-ring-inner)" stroke-width="1.35" stroke-linecap="round" stroke-dasharray="4 6" opacity="0.92" transform="rotate(5 120 120)" />
            <circle cx="120" cy="120" r="86" fill="none" stroke="url(#depth-ring-outer)" stroke-width="1" stroke-linecap="round" stroke-dasharray="3 8" opacity="0.76" transform="rotate(18 120 120)" />
            <circle cx="120" cy="120" r="100" fill="none" stroke="url(#depth-ring-outer)" stroke-width="0.72" stroke-linecap="round" stroke-dasharray="2 11" opacity="0.56" transform="rotate(32 120 120)" />
            <circle cx="120" cy="120" r="114" fill="none" stroke="url(#depth-ring-outer)" stroke-width="0.48" stroke-linecap="round" stroke-dasharray="1.5 14" opacity="0.36" transform="rotate(48 120 120)" />
          </svg>
          <div class="empty-logo-fish absolute left-1/2 top-1/2 z-20 h-40 w-40 sm:h-48 sm:w-48">
            <FsvrLogo
              title="Foursmith VR"
              class="h-full w-full"
            />
          </div>

          <div class="absolute inset-0 z-10">
            <span class="empty-orbit-badge empty-orbit-badge-1">
              <i aria-hidden="true"></i>
              Tiktok
            </span>
            <a
              href="https://github.com/foursmith/vr"
              target="_blank"
              rel="noreferrer"
              aria-label="View foursmith/vr on GitHub"
              class="empty-orbit-badge empty-github-badge empty-orbit-badge-2"
            >
              <img
                src="https://img.shields.io/github/stars/foursmith/vr?style=flat-square&logo=github&logoColor=f5fffc&label=Open%20Source&color=08758f&labelColor=04354e"
                alt="GitHub stars"
                class="rounded-full"
              />
            </a>
            <span class="empty-orbit-badge empty-orbit-badge-6">
              <i aria-hidden="true"></i>
              Foursmith VR
            </span>
            <span class="empty-orbit-badge empty-orbit-badge-5">
              <i aria-hidden="true"></i>
              2D VR player
            </span>
            <span class="empty-orbit-badge empty-orbit-badge-4">
              <i aria-hidden="true"></i>
              Follow face
            </span>
            <span class="empty-orbit-badge empty-orbit-badge-3">
              <i aria-hidden="true"></i>
              Subtitles
            </span>
          </div>
        </div>

        <div class="flex flex-col items-center gap-8">
          <div class="flex flex-col items-center gap-5 sm:gap-6">
            <h1 class="flex items-center gap-2.5 text-[10px] font-medium tracking-[0.18em] sm:text-[11px] sm:tracking-[0.21em]">
              <span class="italic text-[#f5fffc]/42">Watch VR like TikTok</span>
            </h1>
            <Show
              when={props.serverStatus === "authentication-required" || props.serverStatus === "connecting"}
              fallback={(
                <div class="flex flex-col items-center">
                  <MediaPickerButtons onChooseFiles={props.onChooseFiles} onChooseFolder={props.onChooseFolder} />
                  <span class="text-[10px] font-medium leading-2 tracking-[0.018em] text-white/38 sm:text-[11px]">Drop videos here</span>
                </div>
              )}
            >
              <div class="flex w-72 max-w-full flex-col items-center gap-2.5">
                <form
                  class="empty-auth-form w-full"
                  data-invalid={props.serverError ? "true" : "false"}
                  aria-label="Unlock media server"
                  onSubmit={submitPassword}
                >
                  <LiquidGlass
                    class="h-11 w-full rounded-full text-white"
                    cornerRadius={999}
                    elasticity={0.08}
                    castShadow={false}
                  >
                    <div class="flex h-full w-full items-center pl-1.5 pr-24">
                      <input
                        ref={passwordInput}
                        type="password"
                        autocomplete="current-password"
                        aria-label="Password"
                        aria-invalid={props.serverError ? "true" : "false"}
                        value={password()}
                        disabled={props.serverStatus === "connecting"}
                        onInput={event => setPassword(event.currentTarget.value)}
                        placeholder="Password"
                        class="h-full min-w-0 flex-1 border-0 bg-transparent px-2.5 text-xs text-white outline-none placeholder:text-white/28 disabled:cursor-wait"
                      />
                    </div>
                  </LiquidGlass>
                  <button
                    type="submit"
                    disabled={props.serverStatus === "connecting" || !password().trim()}
                    class="absolute inset-y-0 right-1.5 z-10 flex items-center gap-1.5 rounded-r-full border-0 bg-transparent pl-4 pr-3 text-[10px] font-semibold text-white/72 transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-offset--2 focus-visible:outline-accent/60 active:text-accent disabled:cursor-wait disabled:opacity-35"
                  >
                    <span aria-hidden="true" class="absolute left-0 h-4 w-px bg-white/12"></span>
                    {props.serverStatus === "connecting" ? "Checking…" : "Unlock"}
                    <Icon name="unlock" class="h-3 w-3 text-accent/78" />
                  </button>
                </form>
                <p class="text-[10px] leading-0 font-medium tracking-[0.04em] text-white/52 sm:text-[11px]">Enter your media server password</p>
              </div>
            </Show>
          </div>
          {!isChromiumBrowser() ? <BrowserCompatibilityNotice /> : null}
        </div>
      </div>
    </section>
  )
}
