import type { GlobalPreferences, RepeatMode } from "../playback-state"
import { createMemo, createSignal } from "solid-js"
import { DEFAULT_GLOBAL_PREFERENCES } from "../playback-state"

interface PlaybackControllerOptions {
  getVideo: () => HTMLVideoElement
  hideControls: () => void
  initialPreferences: GlobalPreferences
  openVideoFile: () => void
  persistActiveVideo: () => void
  registerPlaybackActivity: () => void
  resourcesReady: () => boolean
  syncTime: () => void
}

export const createPlaybackController = (options: PlaybackControllerOptions) => {
  const [fileName, setFileName] = createSignal<string>()
  const [hasVideo, setHasVideo] = createSignal(false)
  const [playing, setPlaying] = createSignal(false)
  const [currentTime, setCurrentTime] = createSignal(0)
  const [duration, setDuration] = createSignal(0)
  const [volume, setVolume] = createSignal(options.initialPreferences.volume)
  const [playbackRate, setPlaybackRate] = createSignal(options.initialPreferences.playbackRate)
  const [repeatMode, setRepeatMode] = createSignal<RepeatMode>(options.initialPreferences.repeatMode)
  const [autoResumePlayback, setAutoResumePlayback] = createSignal(options.initialPreferences.autoResumePlayback)
  let lastAudibleVolume = options.initialPreferences.volume || DEFAULT_GLOBAL_PREFERENCES.volume
  let suppressNextPauseActivity = false

  const progress = createMemo(() => {
    const total = duration()
    return total ? Math.min(100, Math.max(0, (currentTime() / total) * 100)) : 0
  })

  const togglePlay = () => {
    if (!options.resourcesReady()) return
    const video = options.getVideo()
    if (!video.currentSrc) {
      options.openVideoFile()
    } else if (video.paused) {
      void video.play()
    } else {
      video.pause()
    }
  }

  const togglePlayAndHideControls = () => {
    if (!options.resourcesReady()) return
    const video = options.getVideo()
    suppressNextPauseActivity = Boolean(video.currentSrc && !video.paused)
    togglePlay()
    options.hideControls()
  }

  const seekBy = (amount: number) => {
    if (!options.resourcesReady()) return
    const video = options.getVideo()
    if (!Number.isFinite(video.duration)) return
    video.currentTime = Math.min(video.duration, Math.max(0, video.currentTime + amount))
  }

  const seekTo = (time: number) => {
    const total = duration()
    if (!options.resourcesReady() || !total) return
    const nextTime = Math.min(total, Math.max(0, time))
    options.getVideo().currentTime = nextTime
    setCurrentTime(nextTime)
  }

  const setVolumeLevel = (next: number) => {
    if (!options.resourcesReady()) return
    const video = options.getVideo()
    const clamped = Math.min(1, Math.max(0, next))
    video.volume = clamped
    video.muted = clamped === 0
    if (clamped > 0) lastAudibleVolume = clamped
    setVolume(clamped)
  }

  const setPlaybackRateLevel = (next: number) => {
    if (!Number.isFinite(next) || next <= 0) return
    options.getVideo().playbackRate = next
    setPlaybackRate(next)
  }

  const toggleMute = () => {
    const video = options.getVideo()
    if (volume() === 0 || video.muted) setVolumeLevel(lastAudibleVolume || 0.7)
    else setVolumeLevel(0)
  }

  const handleVolumeChange = () => {
    const video = options.getVideo()
    const nextVolume = video.muted ? 0 : video.volume
    if (nextVolume > 0) lastAudibleVolume = nextVolume
    setVolume(nextVolume)
  }

  const handlePlayingChange = (isPlaying: boolean) => {
    setPlaying(isPlaying)
    if (isPlaying) {
      suppressNextPauseActivity = false
      options.syncTime()
    } else if (suppressNextPauseActivity) {
      suppressNextPauseActivity = false
    } else {
      options.registerPlaybackActivity()
    }
    if (!isPlaying) options.persistActiveVideo()
  }

  const setVideoElement = (element: HTMLVideoElement) => {
    element.volume = options.initialPreferences.volume
    element.muted = options.initialPreferences.volume === 0
    element.playbackRate = options.initialPreferences.playbackRate
  }

  const resetMedia = () => {
    setHasVideo(false)
    setPlaying(false)
    setCurrentTime(0)
    setDuration(0)
    setFileName(undefined)
  }

  return {
    autoResumePlayback,
    currentTime,
    duration,
    fileName,
    handlePlayingChange,
    handleVolumeChange,
    hasVideo,
    playbackRate,
    playing,
    progress,
    repeatMode,
    resetMedia,
    seekBy,
    seekTo,
    setAutoResumePlayback,
    setCurrentTime,
    setDuration,
    setFileName,
    setHasVideo,
    setPlaybackRate: () => setPlaybackRate(options.getVideo().playbackRate),
    setPlaybackRateLevel,
    setPlaying,
    setRepeatMode,
    setVideoElement,
    setVolumeLevel,
    toggleMute,
    togglePlay,
    togglePlayAndHideControls,
    volume,
  }
}
