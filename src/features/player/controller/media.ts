import { fsvrMediaIdentity } from "../../fsvr"
import { isVideoFile } from "../../playlist"
import { videoStateKey } from "../playback-state"

const VIDEO_SWITCH_DEBOUNCE_MS = 180
const VIDEO_RELEASE_SETTLE_MS = 160
const VIDEO_EMPTY_TIMEOUT_MS = 1200

interface VideoResource {
  name: string
  file?: File
  url?: string
}

interface MediaControllerOptions {
  clearSubtitles: () => void
  getPlaylistSubtitle: (id: string | undefined) => { name: string, file?: File, url?: string } | undefined
  hasPlaylistResource: (id: string) => boolean
  initializeVideo: (video: HTMLVideoElement) => void
  isDisposed: () => boolean
  isSceneInitialized: () => boolean
  loadSubtitle: (resource: { name: string, file?: File, url?: string } | undefined, generation: number) => void
  loadVideoHistory: (key: string) => Promise<{ key: string, position: number, projectionId: number } | undefined>
  playbackHistory: {
    activate: (key: string | undefined) => { key: string, position: number, projectionId: number } | undefined
    deactivate: () => void
    persistActive: () => void
    persistLast: () => void
    persistVideo: (playback: { key: string, position: number, projectionId: number }) => Promise<void>
    scheduleSave: () => void
    writeLast: (playback: { key: string, position: number, projectionId: number }) => void
  }
  resetAbLoop: () => void
  resetPlayback: () => void
  resetScene: () => void
  resetSceneMedia: () => void
  resetTransientView: () => void
  resourcesReady: () => boolean
  restoreProjection: (projectionId: number) => void
  setCurrentTime: (time: number) => void
  setDuration: (duration: number) => void
  setFileName: (name: string | undefined) => void
  setHasVideo: (hasVideo: boolean) => void
  setPlaying: (playing: boolean) => void
  setSelectedPlaylistId: (id: string | undefined) => void
  startInitialIdleCountdown: () => void
  syncAbLoopTime: (time: number) => boolean
}

export const createMediaController = (options: MediaControllerOptions) => {
  let video!: HTMLVideoElement
  let fileUrl: string | undefined
  let generation = 0
  let switchTimer: number | undefined
  let switchInProgress = false
  let pendingSwitch: { resource: VideoResource, playlistId?: string } | undefined
  let autoplayPending = false
  let pendingResumeTime: number | undefined

  const syncTime = () => {
    if (pendingResumeTime !== undefined && Number.isFinite(video.duration)) {
      const resumeTime = pendingResumeTime >= video.duration - 5 ? 0 : Math.min(pendingResumeTime, video.duration)
      pendingResumeTime = undefined
      video.currentTime = resumeTime
    }
    const time = video.currentTime || 0
    if (options.syncAbLoopTime(time)) return
    options.setCurrentTime(time)
    options.setDuration(video.duration || 0)
    options.playbackHistory.persistLast()
    options.playbackHistory.scheduleSave()
  }

  const requestPlayback = (loadGeneration = generation) => {
    if (loadGeneration !== generation) return
    if (!video.currentSrc && !video.getAttribute("src")) return
    autoplayPending = false
    void video.play().catch((error) => {
      if (loadGeneration !== generation || (error instanceof DOMException && error.name === "AbortError")) return
      console.warn("video playback could not start", error)
    })
  }

  const detachCurrentSource = async () => {
    const previousUrl = fileUrl
    fileUrl = undefined
    video.pause()
    if (video.currentSrc || video.getAttribute("src")) {
      await new Promise<void>((resolve) => {
        let completed = false
        let timeout: number
        const finish = () => {
          if (completed) return
          completed = true
          window.clearTimeout(timeout)
          video.removeEventListener("emptied", finish)
          resolve()
        }
        timeout = window.setTimeout(finish, VIDEO_EMPTY_TIMEOUT_MS)
        video.addEventListener("emptied", finish, { once: true })
        video.removeAttribute("src")
        video.load()
      })
    } else {
      video.removeAttribute("src")
      video.load()
    }
    if (previousUrl) URL.revokeObjectURL(previousUrl)
    if (!options.isDisposed()) await new Promise<void>(resolve => window.setTimeout(resolve, VIDEO_RELEASE_SETTLE_MS))
  }

  const commitResource = async (resource: VideoResource, playlistId?: string) => {
    const loadGeneration = ++generation
    options.playbackHistory.persistActive()
    options.playbackHistory.deactivate()
    pendingResumeTime = undefined
    options.resetSceneMedia()
    await detachCurrentSource()
    if (options.isDisposed() || loadGeneration !== generation || pendingSwitch) return

    fileUrl = resource.file ? URL.createObjectURL(resource.file) : undefined
    options.setHasVideo(true)
    options.setPlaying(false)
    options.setCurrentTime(0)
    options.setDuration(0)
    const fsvrIdentity = resource.url && fsvrMediaIdentity(resource.url)
    const playbackKey = !fsvrIdentity || fsvrIdentity.sourceId === "local" ? videoStateKey(resource) : undefined
    const resumePlayback = options.playbackHistory.activate(playbackKey)
    options.restoreProjection(resumePlayback?.projectionId ?? 0)
    options.resetTransientView()
    options.resetAbLoop()
    options.setFileName(resource.name)
    options.setSelectedPlaylistId(
      playlistId && options.hasPlaylistResource(playlistId) ? playlistId : undefined,
    )
    options.loadSubtitle(options.getPlaylistSubtitle(playlistId), loadGeneration)
    video.src = fileUrl ?? resource.url ?? ""
    video.load()

    if (resumePlayback) {
      pendingResumeTime = resumePlayback.position
      if (Number.isFinite(video.duration)) syncTime()
      void options.playbackHistory.persistVideo(resumePlayback)
    } else if (playbackKey) {
      try {
        const savedState = await options.loadVideoHistory(playbackKey)
        if (savedState && loadGeneration === generation && !options.isDisposed()) {
          options.restoreProjection(savedState.projectionId)
          pendingResumeTime = savedState.position
          options.playbackHistory.writeLast(savedState)
          if (Number.isFinite(video.duration)) syncTime()
        }
      } catch (error) {
        console.warn("video playback state could not be loaded", error)
      }
    }
    if (loadGeneration !== generation || options.isDisposed()) return
    if (options.isSceneInitialized() && options.resourcesReady()) {
      requestPlayback(loadGeneration)
      options.startInitialIdleCountdown()
    }
  }

  const processPendingSwitch = async () => {
    if (switchInProgress) return
    switchInProgress = true
    try {
      while (pendingSwitch) {
        if (options.isDisposed()) break
        const pending = pendingSwitch
        pendingSwitch = undefined
        await commitResource(pending.resource, pending.playlistId)
      }
    } finally {
      switchInProgress = false
    }
  }

  const scheduleSwitch = (playlistId?: string) => {
    autoplayPending = true
    options.setSelectedPlaylistId(playlistId)
    if (switchTimer !== undefined) window.clearTimeout(switchTimer)
    switchTimer = window.setTimeout(() => {
      switchTimer = undefined
      void processPendingSwitch()
    }, fileUrl || switchInProgress ? VIDEO_SWITCH_DEBOUNCE_MS : 0)
  }

  const loadFile = (file: File, playlistId?: string) => {
    if (!isVideoFile(file)) return
    pendingSwitch = { resource: { name: file.name, file }, playlistId }
    scheduleSwitch(playlistId)
  }

  const loadUrl = (url: string, name: string, playlistId?: string) => {
    pendingSwitch = { resource: { name, url }, playlistId }
    scheduleSwitch(playlistId)
  }

  const cancelPendingSwitch = (removedIds?: ReadonlySet<string>) => {
    if (removedIds && (!pendingSwitch?.playlistId || !removedIds.has(pendingSwitch.playlistId))) return
    if (switchTimer !== undefined) {
      window.clearTimeout(switchTimer)
      switchTimer = undefined
    }
    pendingSwitch = undefined
    if (!switchInProgress) autoplayPending = false
  }

  const reset = () => {
    options.playbackHistory.persistActive()
    generation += 1
    options.playbackHistory.deactivate()
    pendingResumeTime = undefined
    autoplayPending = false
    options.resetScene()
    video.pause()
    video.removeAttribute("src")
    video.load()
    if (fileUrl) URL.revokeObjectURL(fileUrl)
    fileUrl = undefined
    options.resetPlayback()
    options.clearSubtitles()
    options.resetAbLoop()
  }

  const dispose = () => {
    if (switchTimer !== undefined) window.clearTimeout(switchTimer)
    pendingSwitch = undefined
    autoplayPending = false
    options.playbackHistory.persistActive()
    generation += 1
    video.pause()
    video.removeAttribute("src")
    video.load()
    if (fileUrl) URL.revokeObjectURL(fileUrl)
    fileUrl = undefined
  }

  return {
    cancelPendingSwitch,
    dispose,
    getGeneration: () => generation,
    getVideo: () => video,
    isAutoplayPending: () => autoplayPending,
    loadFile,
    loadUrl,
    requestPlayback,
    reset,
    setVideo: (element: HTMLVideoElement) => {
      video = element
      options.initializeVideo(element)
    },
    syncTime,
  }
}
