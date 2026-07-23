import type { PwaUpdateState } from "../../app/pwa-update"
import { createSignal, onSettled, Show } from "solid-js"
import { APP_VERSION, APP_VERSION_URL } from "../../app/build-info"
import { applyPwaUpdate, subscribePwaUpdateState } from "../../app/pwa-update"
import { t } from "../../i18n"

const BURST_COLORS = ["#f5fffc", "#b8f3ec", "#62cfd8", "#7dd3fc"]

function burstUpdateBubble(origin: DOMRect) {
  const layer = document.createElement("div")
  layer.className = "pwa-update-burst-layer"
  layer.setAttribute("aria-hidden", "true")

  const centerX = origin.left + origin.width / 2
  const centerY = origin.top + origin.height / 2

  for (let index = 0; index < 18; index += 1) {
    const angle = (Math.PI * 2 * index) / 18 + (Math.random() - 0.5) * 0.18
    const distance = 36 + Math.random() * 58
    const particle = document.createElement("i")

    particle.className = "pwa-update-burst-particle"
    particle.style.left = `${centerX}px`
    particle.style.top = `${centerY}px`
    particle.style.width = `${5 + Math.random() * 8}px`
    particle.style.height = particle.style.width
    particle.style.animationDelay = `${Math.random() * 45}ms`
    particle.style.setProperty("--burst-color", BURST_COLORS[index % BURST_COLORS.length])
    particle.style.setProperty("--burst-x", `${Math.cos(angle) * distance}px`)
    particle.style.setProperty("--burst-y", `${Math.sin(angle) * distance}px`)
    layer.append(particle)
  }

  document.body.append(layer)
  window.setTimeout(() => layer.remove(), 700)
}

function popUpdateBubble(bubble: HTMLElement) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return

  const origin = bubble.getBoundingClientRect()
  const clone = bubble.cloneNode(true) as HTMLElement

  clone.className = "pwa-update-bubble pwa-update-pop-clone"
  clone.removeAttribute("href")
  clone.removeAttribute("aria-label")
  clone.setAttribute("aria-hidden", "true")
  clone.style.left = `${origin.left}px`
  clone.style.top = `${origin.top}px`

  bubble.style.visibility = "hidden"
  document.body.append(clone)
  burstUpdateBubble(origin)
  window.setTimeout(() => clone.remove(), 650)
  return clone
}

export function PwaUpdateBubble() {
  const [state, setState] = createSignal<PwaUpdateState>("idle")
  let interactionPending = false

  onSettled(() => subscribePwaUpdateState(setState))

  const reloadToUpdate = (event: MouseEvent & { currentTarget: HTMLButtonElement }) => {
    if (interactionPending) return
    interactionPending = true

    const bubble = event.currentTarget
    const popClone = popUpdateBubble(bubble)

    window.setTimeout(() => {
      void applyPwaUpdate().catch((error) => {
        interactionPending = false
        bubble.style.removeProperty("visibility")
        popClone?.remove()
        console.warn("service worker update failed", error)
      })
    }, popClone ? 420 : 0)
  }

  const viewUpdateDetails = (event: MouseEvent & { currentTarget: HTMLAnchorElement }) => {
    event.preventDefault()
    if (interactionPending) return
    interactionPending = true

    popUpdateBubble(event.currentTarget)
    window.setTimeout(() => window.location.assign(APP_VERSION_URL), 500)
  }

  return (
    <Show when={state() !== "idle"}>
      <aside class="pwa-update-anchor" role="status" aria-live="polite">
        <Show
          when={state() === "ready" || state() === "applying"}
          fallback={(
            <a
              href={APP_VERSION_URL}
              class="pwa-update-bubble pwa-update-bubble-success"
              aria-label={t("update.details", APP_VERSION)}
              onClick={viewUpdateDetails}
            >
              <span>{t("update.successful")}</span>
              <small>{APP_VERSION}</small>
            </a>
          )}
        >
          <button
            type="button"
            class="pwa-update-bubble pwa-update-bubble-ready"
            disabled={state() === "applying"}
            aria-label={t("update.reload")}
            onClick={reloadToUpdate}
          >
            <span>{state() === "applying" ? t("update.updating") : t("update.reloadToUpdate")}</span>
            <small>{state() === "applying" ? t("update.oneMoment") : t("update.ready")}</small>
          </button>
        </Show>
      </aside>
    </Show>
  )
}
