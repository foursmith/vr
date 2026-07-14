import { createSignal, Show } from "solid-js"
import { isChromiumBrowser } from "../../lib/browser"
import { BrowserCompatibilityNotice } from "../BrowserCompatibilityNotice"
import { FsvrLogo } from "../ui/FsvrLogo"
import { Icon } from "../ui/Icon"
import { LiquidGlass } from "../ui/LiquidGlass"
import { MediaPickerButtons } from "../ui/MediaPickerButtons"
import { OceanBackground } from "./OceanBackground"

type ServerStatus = "disconnected" | "connecting" | "authentication-required" | "connected" | "error"

const GITHUB_URL = "https://github.com/foursmith/vr"
const CONFETTI_COLORS = ["#b8f3ec", "#62cfd8", "#f5fffc", "#7dd3fc", "#fda4af"]

function launchGithubConfetti(origin: DOMRect) {
  const layer = document.createElement("div")
  layer.className = "empty-github-confetti-layer"
  layer.setAttribute("aria-hidden", "true")

  const centerX = origin.left + origin.width / 2
  const centerY = origin.top + origin.height / 2

  for (let index = 0; index < 24; index += 1) {
    const angle = (Math.PI * 2 * index) / 24 + (Math.random() - 0.5) * 0.24
    const distance = 52 + Math.random() * 58
    const midDistance = distance * 0.58
    const particle = document.createElement("i")

    particle.className = "empty-github-confetti-particle"
    particle.style.left = `${centerX}px`
    particle.style.top = `${centerY}px`
    particle.style.width = `${4 + Math.random() * 3}px`
    particle.style.height = `${5 + Math.random() * 6}px`
    particle.style.animationDelay = `${Math.random() * 45}ms`
    particle.style.setProperty("--confetti-color", CONFETTI_COLORS[index % CONFETTI_COLORS.length])
    particle.style.setProperty("--confetti-mid-x", `${Math.cos(angle) * midDistance}px`)
    particle.style.setProperty("--confetti-mid-y", `${Math.sin(angle) * midDistance - 22}px`)
    particle.style.setProperty("--confetti-end-x", `${Math.cos(angle) * distance}px`)
    particle.style.setProperty("--confetti-end-y", `${Math.sin(angle) * distance + 42}px`)
    particle.style.setProperty("--confetti-mid-rotation", `${180 + Math.random() * 180}deg`)
    particle.style.setProperty("--confetti-end-rotation", `${540 + Math.random() * 360}deg`)
    layer.append(particle)
  }

  document.body.append(layer)
  window.setTimeout(() => layer.remove(), 900)
}

export function EmptyState(props: {
  serverStatus: ServerStatus
  serverError?: string
  onAuthenticate: (password: string) => Promise<void>
  onChooseFiles: () => void
  onChooseFolder: () => void
}) {
  const [password, setPassword] = createSignal("")
  let passwordInput: HTMLInputElement | undefined
  let githubNavigationPending = false

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

  const celebrateGithub = (event: MouseEvent & { currentTarget: HTMLAnchorElement }) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || githubNavigationPending) return

    event.preventDefault()
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      window.open(GITHUB_URL, "_blank", "noopener,noreferrer")
      return
    }

    githubNavigationPending = true
    const link = event.currentTarget
    link.classList.add("empty-github-burst")
    launchGithubConfetti(link.getBoundingClientRect())
    window.setTimeout(() => {
      link.classList.remove("empty-github-burst")
      window.open(GITHUB_URL, "_blank", "noopener,noreferrer")
      githubNavigationPending = false
    }, 760)
  }

  return (
    <section class="empty-state-surface absolute inset-0 z-10 flex items-center justify-center overflow-hidden px-5 py-8 text-center text-white sm:px-10 sm:py-12">
      <OceanBackground />
      <div class="empty-state-drift relative z-10 flex flex-col items-center gap-3 sm:gap-4">
        <div class="relative h-60 w-88 sm:h-68 sm:w-100">
          <div class="empty-hero-logo absolute left-1/2 top-1/2 z-20 size-40 sm:size-48">
            <FsvrLogo
              title="Foursmith VR"
              class="h-full w-full"
            />
          </div>

          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer"
            aria-label="View foursmith/vr on GitHub"
            class="absolute left-[calc(50%+4rem)] top-1/2 z-15 flex size-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full p-1 text-[#dafaf5]/58 transition-colors hover:text-[#f5fffc]/94 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#b8f3ec]/72 focus-visible:text-[#f5fffc]/94 sm:left-[calc(50%+5rem)]"
            onClick={celebrateGithub}
          >
            <Icon name="github" class="empty-github-icon size-8" />
          </a>

          <span aria-label="No headset" role="img" tabindex="0" class="empty-feature-dot empty-feature-tiktok">
            <span aria-hidden="true" class="empty-feature-label">No headset</span>
          </span>
          <span aria-label="Open source" role="img" tabindex="0" class="empty-feature-dot empty-feature-open-source">
            <span aria-hidden="true" class="empty-feature-label">Open source</span>
          </span>
          <span aria-label="Portrait layout" role="img" tabindex="0" class="empty-feature-dot empty-feature-portrait-layout">
            <span aria-hidden="true" class="empty-feature-label">Portrait layout</span>
          </span>
          <span aria-label="Face centering" role="img" tabindex="0" class="empty-feature-dot empty-feature-face-tracking">
            <span aria-hidden="true" class="empty-feature-label">Face centering</span>
          </span>
          <span aria-label="Auto-framed VR" role="img" tabindex="0" class="empty-feature-dot empty-feature-vr-player">
            <span aria-hidden="true" class="empty-feature-label">Auto-framed VR</span>
          </span>
          <span aria-label="Foursmith VR" role="img" tabindex="0" class="empty-feature-dot empty-feature-brand">
            <span aria-hidden="true" class="empty-feature-label">Foursmith VR</span>
          </span>
        </div>

        <div class="flex flex-col items-center gap-8">
          <div class="flex flex-col items-center gap-5 sm:gap-6">
            <h1 class="text-[10px] font-medium italic tracking-[0.18em] text-[#f5fffc]/42 sm:text-[11px] sm:tracking-[0.21em]">Watch VR like TikTok</h1>
            <Show
              when={props.serverStatus === "authentication-required" || props.serverStatus === "connecting"}
              fallback={(
                <MediaPickerButtons onChooseFiles={props.onChooseFiles} onChooseFolder={props.onChooseFolder} />
              )}
            >
              <div class="flex w-72 max-w-full flex-col items-center gap-2.5">
                <form
                  class="empty-auth-form relative w-full rounded-full"
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
