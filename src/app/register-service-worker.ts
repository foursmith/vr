import { registerSW } from "virtual:pwa-register"
import { markPwaUpdateReady } from "./pwa-update"

registerSW({
  immediate: true,
  onNeedReload: markPwaUpdateReady,
  onRegisterError(error) {
    console.warn("service worker registration failed", error)
  },
})
