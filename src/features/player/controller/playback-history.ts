import type { LastPlayback, VideoPlaybackState } from "../playback-storage"
import {
  flushPendingPlayback,
  loadLastPlaybackKey,
  loadPendingPlayback,
  persistVideoPlaybackState,
  remapLastPlaybackKey,
  resolveVideoPlaybackState,
  saveLastPlaybackKey,
  savePendingPlayback,
} from "../playback-storage"

const VIDEO_STATE_SAVE_INTERVAL_MS = 5_000
const LAST_PLAYBACK_SAVE_INTERVAL_MS = 1_000

interface PlaybackHistoryOptions {
  getProjectionId: () => number
  getVideo: () => HTMLVideoElement
}

export const createPlaybackHistory = (options: PlaybackHistoryOptions) => {
  let activeVideoKey: string | undefined
  let lastPlaybackKey = loadLastPlaybackKey()
  let lastPlaybackSavedAt = 0
  let videoStateSaveTimer: number | undefined

  const activeSnapshot = (projectionId = options.getProjectionId()): LastPlayback | undefined => {
    if (!activeVideoKey) return
    return {
      key: activeVideoKey,
      position: options.getVideo().currentTime || 0,
      projectionId,
    }
  }

  const persistVideo = async (playback: LastPlayback | VideoPlaybackState) => {
    try {
      await persistVideoPlaybackState({
        ...playback,
        updatedAt: "updatedAt" in playback ? playback.updatedAt : Date.now(),
      })
    } catch (error) {
      console.warn("video playback state could not be saved", error)
    }
  }

  const writeLast = (playback: LastPlayback | VideoPlaybackState) => {
    lastPlaybackKey = playback.key
    savePendingPlayback(playback)
    lastPlaybackSavedAt = Date.now()
  }

  const persistLast = (force = false, projectionId = options.getProjectionId()) => {
    const now = Date.now()
    if (!force && now - lastPlaybackSavedAt < LAST_PLAYBACK_SAVE_INTERVAL_MS) return
    const playback = activeSnapshot(projectionId)
    if (playback) writeLast(playback)
  }

  const scheduleSave = (delay = VIDEO_STATE_SAVE_INTERVAL_MS) => {
    if (!activeVideoKey || videoStateSaveTimer !== undefined) return
    videoStateSaveTimer = window.setTimeout(() => {
      videoStateSaveTimer = undefined
      const playback = activeSnapshot()
      if (playback) void persistVideo(playback)
    }, delay)
  }

  const persistActive = async () => {
    if (videoStateSaveTimer !== undefined) window.clearTimeout(videoStateSaveTimer)
    videoStateSaveTimer = undefined
    const playback = activeSnapshot()
    if (!playback) return
    writeLast(playback)
    await persistVideo(playback)
  }

  const activate = async (key: string | undefined) => {
    activeVideoKey = key
    if (!key) return
    lastPlaybackKey = key
    saveLastPlaybackKey(key)
    const resumePlayback = await resolveVideoPlaybackState(key)
    if (activeVideoKey !== key) return
    return resumePlayback
  }

  // localStorage is the synchronous write-back checkpoint for abrupt page
  // closes. Merge it into IndexedDB as soon as the controller starts instead
  // of waiting for the same video to be selected again.
  if (loadPendingPlayback()) {
    void flushPendingPlayback().catch(error => console.warn("last playback could not be flushed", error))
  }

  return {
    activate,
    deactivate: () => (activeVideoKey = undefined),
    getLastKey: () => lastPlaybackKey,
    persistActive,
    persistLast,
    persistVideo,
    remapLastKey: (key: string) => {
      if (!lastPlaybackKey || lastPlaybackKey === key) return
      remapLastPlaybackKey(key)
      lastPlaybackKey = key
    },
    scheduleSave,
    writeLast,
  }
}
