import type { LastPlayback } from "../playback-state"
import {
  loadLastPlayback,
  loadVideoPlaybackState,
  saveLastPlayback,
  saveVideoPlaybackState,
} from "../playback-state"

const VIDEO_STATE_SAVE_INTERVAL_MS = 10_000
const LAST_PLAYBACK_SAVE_INTERVAL_MS = 1_000

interface PlaybackHistoryOptions {
  getProjectionId: () => number
  getVideo: () => HTMLVideoElement
}

export const createPlaybackHistory = (options: PlaybackHistoryOptions) => {
  let activeVideoKey: string | undefined
  let lastPlayback = loadLastPlayback()
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

  const persistVideo = async (playback: LastPlayback) => {
    try {
      await saveVideoPlaybackState({ ...playback, updatedAt: Date.now() })
    } catch (error) {
      console.warn("video playback state could not be saved", error)
    }
  }

  const writeLast = (playback: LastPlayback) => {
    lastPlayback = {
      key: playback.key,
      position: playback.position,
      projectionId: playback.projectionId,
    }
    saveLastPlayback(lastPlayback)
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

  const persistActive = () => {
    if (videoStateSaveTimer !== undefined) window.clearTimeout(videoStateSaveTimer)
    videoStateSaveTimer = undefined
    const playback = activeSnapshot()
    if (!playback) return
    writeLast(playback)
    void persistVideo(playback)
  }

  const activate = (key: string | undefined) => {
    activeVideoKey = key
    if (!key) return
    const resumePlayback = lastPlayback?.key === key ? lastPlayback : undefined
    writeLast(resumePlayback ?? { key, position: 0, projectionId: 0 })
    return resumePlayback
  }

  return {
    activate,
    deactivate: () => (activeVideoKey = undefined),
    getLast: () => lastPlayback,
    loadVideo: loadVideoPlaybackState,
    persistActive,
    persistLast,
    persistVideo,
    remapLastKey: (key: string) => {
      if (lastPlayback) lastPlayback = { ...lastPlayback, key }
    },
    scheduleSave,
    writeLast,
  }
}
