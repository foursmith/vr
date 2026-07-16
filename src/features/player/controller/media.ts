import { fsvrMediaIdentity } from "../../fsvr"
import { isVideoFile } from "../../playlist"
import { videoStateKey } from "../playback-state"

interface VideoResource {
  name: string
  file?: File
  url?: string
}

interface MediaControllerOptions {
  clearMediaFrame: () => void
  clearSubtitles: () => void
  getPlaylistSubtitle: (id: string | undefined) => { name: string, file?: File, url?: string } | undefined
  hasPlaylistResource: (id: string) => boolean
  initializeVideo: (video: HTMLVideoElement) => void
  isDisposed: () => boolean
  loadSubtitle: (resource: { name: string, file?: File, url?: string } | undefined, generation: number) => void
  playbackHistory: {
    activate: (key: string | undefined) => Promise<{ key: string, position: number, projectionId: number } | undefined>
    deactivate: () => void
    persistActive: () => Promise<void>
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
  let playbackStatePending = false

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
    if (playbackStatePending) return
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

  const commitResource = (resource: VideoResource, playlistId?: string) => {
    const loadGeneration = ++generation
    void options.playbackHistory.persistActive()
    options.playbackHistory.deactivate()
    pendingResumeTime = undefined
    playbackStatePending = false
    const previousUrl = fileUrl
    video.pause()
    options.clearMediaFrame()
    if (options.isDisposed() || loadGeneration !== generation) return

    fileUrl = resource.file ? URL.createObjectURL(resource.file) : undefined
    options.setHasVideo(true)
    options.setPlaying(false)
    options.setCurrentTime(0)
    options.setDuration(0)
    const fsvrIdentity = resource.url && fsvrMediaIdentity(resource.url)
    const playbackKey = !fsvrIdentity || fsvrIdentity.sourceId === "local" ? videoStateKey(resource) : undefined
    playbackStatePending = Boolean(playbackKey)
    const resumePlaybackPromise = options.playbackHistory.activate(playbackKey)
    options.resetTransientView()
    options.resetAbLoop()
    options.setFileName(resource.name)
    options.setSelectedPlaylistId(
      playlistId && options.hasPlaylistResource(playlistId) ? playlistId : undefined,
    )
    options.loadSubtitle(options.getPlaylistSubtitle(playlistId), loadGeneration)
    video.src = fileUrl ?? resource.url ?? ""
    video.load()
    if (previousUrl) URL.revokeObjectURL(previousUrl)
    requestPlayback(loadGeneration)
    options.startInitialIdleCountdown()
    window.setTimeout(() => {
      if (loadGeneration === generation && !options.isDisposed()) options.resetSceneMedia()
    }, 0)

    void (async () => {
      let resumePlayback: Awaited<typeof resumePlaybackPromise>
      try {
        resumePlayback = await resumePlaybackPromise
      } catch (error) {
        console.warn("video playback state could not be loaded", error)
      }
      if (loadGeneration !== generation || options.isDisposed()) return
      playbackStatePending = false
      if (resumePlayback) {
        options.restoreProjection(resumePlayback.projectionId)
        pendingResumeTime = resumePlayback.position
        if (Number.isFinite(video.duration)) syncTime()
      } else if (playbackKey) {
        options.restoreProjection(0)
        options.playbackHistory.writeLast({ key: playbackKey, position: 0, projectionId: 0 })
      }
      requestPlayback(loadGeneration)
    })()
  }

  const processPendingSwitch = () => {
    if (switchInProgress) return
    switchInProgress = true
    try {
      while (pendingSwitch) {
        if (options.isDisposed()) break
        const pending = pendingSwitch
        pendingSwitch = undefined
        commitResource(pending.resource, pending.playlistId)
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
      processPendingSwitch()
    }, 0)
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
    void options.playbackHistory.persistActive()
    generation += 1
    options.playbackHistory.deactivate()
    pendingResumeTime = undefined
    playbackStatePending = false
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
    void options.playbackHistory.persistActive()
    generation += 1
    playbackStatePending = false
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
