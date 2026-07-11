import { registerSW } from "virtual:pwa-register"

const updateIntervalMs = 5 * 60 * 1000
let pendingReload = false

const hasLoadedVideo = () => {
  const video = document.getElementById("video")
  return video instanceof HTMLVideoElement && Boolean(video.currentSrc)
}

const reloadWhenNoVideo = () => {
  if (!pendingReload) return
  if (hasLoadedVideo()) return

  window.location.reload()
}

const checkForUpdate = async (swUrl: string, registration: ServiceWorkerRegistration) => {
  if (registration.installing || !navigator.onLine) return

  const response = await fetch(swUrl, {
    cache: "no-store",
    headers: {
      "cache": "no-store",
      "cache-control": "no-cache",
    },
  })

  if (response.status === 200) {
    await registration.update()
  }
}

registerSW({
  immediate: true,
  onRegisteredSW(swUrl, registration) {
    if (!registration) return

    const update = () => {
      reloadWhenNoVideo()
      void checkForUpdate(swUrl, registration).catch((error) => {
        console.warn("service worker update check failed", error)
      })
    }

    window.setInterval(update, updateIntervalMs)
    document.addEventListener("visibilitychange", () => {
      reloadWhenNoVideo()
      if (document.visibilityState === "visible") update()
    })
  },
  onNeedReload() {
    pendingReload = true
    reloadWhenNoVideo()
  },
  onRegisterError(error) {
    console.warn("service worker registration failed", error)
  },
})
