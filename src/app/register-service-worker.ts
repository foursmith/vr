import { registerSW } from "virtual:pwa-register"
import {
  applyPwaUpdate,
  hadPendingPwaUpdateAtStartup,
  markPwaUpdateReady,
  markPwaUpdateSuccessful,
} from "./pwa-update"

const pendingAtStartup = hadPendingPwaUpdateAtStartup()
let updateDetected = false

const applyUpdate = () => {
  void applyPwaUpdate().catch((error) => {
    console.warn("service worker update failed", error)
  })
}

const updateServiceWorker = registerSW({
  immediate: true,
  onNeedRefresh() {
    updateDetected = true
    markPwaUpdateReady(() => updateServiceWorker(true))
    if (pendingAtStartup) applyUpdate()
  },
  onRegisteredSW(_swUrl, registration) {
    if (!pendingAtStartup || !registration) return

    queueMicrotask(() => {
      if (!updateDetected && !registration.waiting && !registration.installing) {
        markPwaUpdateSuccessful()
      }
    })
  },
  onRegisterError(error) {
    console.warn("service worker registration failed", error)
  },
})
