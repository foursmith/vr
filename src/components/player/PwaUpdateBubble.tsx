import { createSignal, onSettled, Show } from "solid-js"
import appPackage from "../../../package.json"
import { subscribePwaUpdateReady } from "../../app/pwa-update"

const RELEASE_URL = `${appPackage.homepage}/releases/latest`

export function PwaUpdateBubble() {
  const [updateReady, setUpdateReady] = createSignal(false)

  onSettled(() => subscribePwaUpdateReady(setUpdateReady))

  return (
    <Show when={updateReady()}>
      <aside class="empty-update-bubble" role="status" aria-live="polite">
        <div class="empty-update-bubble-body">
          <span>Update successful</span>
          <a href={RELEASE_URL} target="_blank" rel="noreferrer">What’s new</a>
        </div>
      </aside>
    </Show>
  )
}
