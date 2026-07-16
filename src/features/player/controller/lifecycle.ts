import { onSettled } from "solid-js"

const LOCAL_PLAYLIST_REFRESH_INTERVAL_MS = 10_000

interface PlayerLifecycleOptions {
  connectServer: (() => Promise<void>) | undefined
  dispose: () => void
  handleFullscreenChange: () => void
  handleKeydown: (event: KeyboardEvent) => void
  persistActiveVideo: () => void
  refreshLocalPlaylist: () => Promise<void>
}

export const setupPlayerLifecycle = (options: PlayerLifecycleOptions) => {
  onSettled(() => {
    window.addEventListener("keydown", options.handleKeydown)
    document.addEventListener("fullscreenchange", options.handleFullscreenChange)
    if (options.connectServer) {
      void options.connectServer().catch(error => console.warn("fsvr connection failed", error))
    }

    let refreshTimer: number | undefined
    let refreshInFlight = false
    const refresh = async () => {
      if (refreshInFlight) return
      refreshInFlight = true
      try {
        await options.refreshLocalPlaylist()
      } catch (error) {
        console.warn("local playlist refresh failed", error)
      } finally {
        refreshInFlight = false
      }
    }
    const stopRefresh = () => {
      if (refreshTimer === undefined) return
      window.clearInterval(refreshTimer)
      refreshTimer = undefined
    }
    const startRefresh = () => {
      if (refreshTimer !== undefined || document.hidden) return
      refreshTimer = window.setInterval(() => void refresh(), LOCAL_PLAYLIST_REFRESH_INTERVAL_MS)
    }
    const handleVisibilityChange = () => {
      if (document.hidden) {
        stopRefresh()
        options.persistActiveVideo()
      } else {
        void refresh()
        startRefresh()
      }
    }
    document.addEventListener("visibilitychange", handleVisibilityChange)
    window.addEventListener("pagehide", options.persistActiveVideo)
    startRefresh()

    return () => {
      window.removeEventListener("keydown", options.handleKeydown)
      document.removeEventListener("fullscreenchange", options.handleFullscreenChange)
      document.removeEventListener("visibilitychange", handleVisibilityChange)
      window.removeEventListener("pagehide", options.persistActiveVideo)
      stopRefresh()
      options.dispose()
    }
  })
}
