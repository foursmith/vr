export interface VrDiagnosticsSnapshot {
  projection: string
  quality: string
  frameRate: number
  splitCount: number
  viewport: { width: number, height: number }
  canvas: { width: number, height: number, pixelRatio: number }
  faceAutoCenter: boolean
  tracking: {
    activity: string
    phase: string
    retryAt: number
    isMoving: boolean
    rescanDuringMovement: boolean
    detectorActive: boolean
    view: { yaw: number, pitch: number, forward: number }
    target?: { mode: string, yaw?: number, pitch?: number, forward?: number }
    error?: { yaw: number, pitch: number, forward: number }
    blockedAxis?: string
    motion?: { size: number, speed: number, recedingSpeed: number, lastSeenAt: number }
    velocity: { forward: number }
  }
}

export type VrTrackingDiagnosticEvent
  = | { type: "capture", durationMs: number, inputSize: string }
    | { type: "inference", completedAt: number, durationMs: number }
    | { type: "skip" }

export interface VrDiagnostics {
  setEnabled: (enabled: boolean) => void
  recordMediaEvent: (name: string, at?: number) => void
  recordPlaying: (at?: number) => void
  recordWaiting: (at?: number) => void
  recordStalled: (at?: number) => void
  recordVideoFrame: (now: number, metadata: VideoFrameCallbackMetadata) => void
  recordSchedule: (sample: {
    rendered: boolean
    deadlineLatenessMs?: number
    targetFrameRate: number
  }) => void
  recordRenderedFrame: (sample: { now: number, frameTimeMs: number, renderMs: number }) => void
  recordTracking: (event: VrTrackingDiagnosticEvent) => void
  resetCadence: () => void
  resetPlayback: () => void
  resetVideoFrameMetrics: () => void
  resetMedia: () => void
  destroy: () => void
}

interface PlaybackQualitySnapshot {
  dropped: number
  total: number
}

interface CreateVrDiagnosticsOptions {
  video: HTMLVideoElement
  panelElement: HTMLElement
  getSnapshot: () => VrDiagnosticsSnapshot
  getGpuLabel: () => string
  now?: () => number
}

const percentile = (values: number[], fraction: number) => {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? 0
}

export const createVrDiagnostics = ({
  video,
  panelElement,
  getSnapshot,
  getGpuLabel,
  now: readNow = () => performance.now(),
}: CreateVrDiagnosticsOptions): VrDiagnostics => {
  const metricsElement = panelElement.querySelector<HTMLElement>("[data-debug-metrics]") ?? panelElement
  const logElement = panelElement.querySelector<HTMLElement>("[data-debug-log]")
  let enabled = false
  let destroyed = false
  let longTaskObserver: PerformanceObserver | undefined
  let gpuRenderer = "--"

  let videoSourceFrameRate = 0
  let previousVideoMediaTime: number | undefined
  let previousPresentedFrames: number | undefined
  const recentVideoFrameRates: number[] = []
  let lastPlaybackQuality: PlaybackQualitySnapshot | undefined
  let videoCallbackCount = 0
  let videoCallbackFrameGaps = 0
  let previousVideoCallbackAt: number | undefined
  const recentVideoCallbackIntervals: number[] = []
  const recentVideoCallbackLateness: number[] = []
  const recentVideoProcessingTimes: number[] = []
  let scheduledRenderSkips = 0
  let missedRenderDeadlines = 0
  const recentRenderDeadlineLateness: number[] = []
  let waitingEvents = 0
  let stalledEvents = 0
  let bufferingStartedAt: number | undefined
  let bufferingDurationMs = 0
  let lastMediaEvent = "init"
  let lastMediaEventAt = readNow()
  const recentLongTasks: { at: number, duration: number }[] = []

  let fpsSampleStartedAt = lastMediaEventAt
  let fpsFrameCount = 0
  const recentFrameTimes: number[] = []
  const recentRenderTimes: number[] = []
  let lastRenderMs = 0
  let recentInferenceCompletions: number[] = []
  const recentInferenceTimes: number[] = []
  let lastInferenceMs = 0
  let lastCaptureMs = 0
  let lastInputSize = "--"
  let skippedInferenceFrames = 0

  const readPlaybackQuality = (): PlaybackQualitySnapshot | undefined => {
    if (typeof video.getVideoPlaybackQuality === "function") {
      const quality = video.getVideoPlaybackQuality()
      return { dropped: quality.droppedVideoFrames, total: quality.totalVideoFrames }
    }
    const legacyVideo = video as HTMLVideoElement & {
      webkitDecodedFrameCount?: number
      webkitDroppedFrameCount?: number
    }
    if (typeof legacyVideo.webkitDecodedFrameCount === "number" && typeof legacyVideo.webkitDroppedFrameCount === "number") {
      return { dropped: legacyVideo.webkitDroppedFrameCount, total: legacyVideo.webkitDecodedFrameCount }
    }
  }

  const resetRenderMetrics = () => {
    fpsFrameCount = 0
    fpsSampleStartedAt = readNow()
    recentFrameTimes.length = 0
    recentRenderTimes.length = 0
    lastRenderMs = 0
    recentInferenceCompletions = []
    recentInferenceTimes.length = 0
    lastInferenceMs = 0
    lastCaptureMs = 0
    lastInputSize = "--"
    skippedInferenceFrames = 0
  }

  const resetPlayback = () => {
    lastPlaybackQuality = enabled ? readPlaybackQuality() : undefined
    videoCallbackCount = 0
    videoCallbackFrameGaps = 0
    previousVideoCallbackAt = undefined
    recentVideoCallbackIntervals.length = 0
    recentVideoCallbackLateness.length = 0
    recentVideoProcessingTimes.length = 0
    scheduledRenderSkips = 0
    missedRenderDeadlines = 0
    recentRenderDeadlineLateness.length = 0
    waitingEvents = 0
    stalledEvents = 0
    bufferingStartedAt = undefined
    bufferingDurationMs = 0
    lastMediaEvent = "reset"
    lastMediaEventAt = readNow()
    recentLongTasks.length = 0
  }

  const resetVideoFrameMetrics = () => {
    videoSourceFrameRate = 0
    previousVideoMediaTime = undefined
    previousPresentedFrames = undefined
    recentVideoFrameRates.length = 0
  }

  const resetCadence = () => {
    previousVideoCallbackAt = undefined
    recentVideoCallbackIntervals.length = 0
    recentVideoCallbackLateness.length = 0
    recentRenderDeadlineLateness.length = 0
  }

  const stop = () => {
    longTaskObserver?.disconnect()
    longTaskObserver = undefined
    gpuRenderer = "--"
    resetPlayback()
    resetVideoFrameMetrics()
    resetRenderMetrics()
    metricsElement.textContent = "Waiting for frames…"
  }

  const start = () => {
    resetPlayback()
    resetRenderMetrics()
    try {
      gpuRenderer = getGpuLabel()
    } catch {
      gpuRenderer = "--"
    }
    if (typeof PerformanceObserver === "undefined") return
    longTaskObserver = new PerformanceObserver((list) => {
      if (!enabled) return
      const observedAt = readNow()
      list.getEntries().forEach(entry => recentLongTasks.push({ at: observedAt, duration: entry.duration }))
      if (recentLongTasks.length > 200) recentLongTasks.splice(0, recentLongTasks.length - 200)
    })
    try {
      longTaskObserver.observe({ type: "longtask", buffered: false })
    } catch {
      longTaskObserver.disconnect()
      longTaskObserver = undefined
    }
  }

  const updateMetrics = (sampleNow: number, frameTimeMs: number) => {
    fpsFrameCount += 1
    if (frameTimeMs > 0 && frameTimeMs < 1000) {
      recentFrameTimes.push(frameTimeMs)
      if (recentFrameTimes.length > 180) recentFrameTimes.shift()
    }

    const elapsed = sampleNow - fpsSampleStartedAt
    if (elapsed < 500) return

    const snapshot = getSnapshot()
    const fps = Math.max(1, Math.round((fpsFrameCount * 1000) / elapsed))
    const p95 = percentile(recentFrameTimes, 0.95)
    const renderP95 = percentile(recentRenderTimes, 0.95)
    recentInferenceCompletions = recentInferenceCompletions.filter(time => sampleNow - time <= 2000)
    const trackingSpan = recentInferenceCompletions.length > 1
      ? recentInferenceCompletions[recentInferenceCompletions.length - 1] - recentInferenceCompletions[0]
      : 0
    const trackingHz = trackingSpan > 0
      ? ((recentInferenceCompletions.length - 1) * 1000) / trackingSpan
      : 0
    const renderStrategy = snapshot.splitCount <= 1
      ? "Single view"
      : `Split ${snapshot.splitCount} · render ${snapshot.splitCount}×`
    const videoFrameRateLabel = videoSourceFrameRate
      ? String(Math.round(videoSourceFrameRate * 100) / 100)
      : "--"
    const playbackQuality = readPlaybackQuality()
    const decodedSinceSample = playbackQuality && lastPlaybackQuality
      ? Math.max(0, playbackQuality.total - lastPlaybackQuality.total)
      : 0
    const droppedSinceSample = playbackQuality && lastPlaybackQuality
      ? Math.max(0, playbackQuality.dropped - lastPlaybackQuality.dropped)
      : 0
    const droppedPercent = decodedSinceSample > 0 ? (droppedSinceSample / decodedSinceSample) * 100 : 0
    const callbackRate = (videoCallbackCount * 1000) / elapsed
    const callbackP95 = percentile(recentVideoCallbackIntervals, 0.95)
    const callbackLateP95 = percentile(recentVideoCallbackLateness, 0.95)
    const processingP95 = percentile(recentVideoProcessingTimes, 0.95)
    const deadlineLateP95 = percentile(recentRenderDeadlineLateness, 0.95)
    const inferenceP95 = percentile(recentInferenceTimes, 0.95)
    while (recentLongTasks[0] && sampleNow - recentLongTasks[0].at > 5000) recentLongTasks.shift()
    const longTaskDuration = recentLongTasks.reduce((total, task) => total + task.duration, 0)
    const longTaskMax = recentLongTasks.reduce((maximum, task) => Math.max(maximum, task.duration), 0)
    const bufferingMs = bufferingDurationMs + (bufferingStartedAt === undefined ? 0 : sampleNow - bufferingStartedAt)
    const bufferedEnd = video.buffered.length > 0 ? video.buffered.end(video.buffered.length - 1) : video.currentTime
    const bufferedAhead = Math.max(0, bufferedEnd - video.currentTime)
    const faceSampleAge = snapshot.tracking.motion
      ? Math.max(0, sampleNow - snapshot.tracking.motion.lastSeenAt) / 1000
      : 0
    const currentMotion = snapshot.tracking.motion && faceSampleAge < 1.5 ? snapshot.tracking.motion : undefined

    metricsElement.textContent = [
      `RENDER   ${fps} fps · ${p95.toFixed(1)} ms p95`,
      `VIDEO    ${video.videoWidth || "--"}×${video.videoHeight || "--"} · ${videoFrameRateLabel} fps · drop ${playbackQuality?.dropped ?? "--"}/${playbackQuality?.total ?? "--"}`,
      `DECODE   +${droppedSinceSample}/${decodedSinceSample} (${droppedPercent.toFixed(1)}%) · process ${processingP95.toFixed(1)} ms p95`,
      `CALLBACK ${callbackRate.toFixed(1)} Hz · ${callbackP95.toFixed(1)} ms p95 · late ${callbackLateP95.toFixed(1)} ms`,
      `SCHED    skip ${scheduledRenderSkips} · miss ${missedRenderDeadlines} · late ${deadlineLateP95.toFixed(1)} ms`,
      `MAIN     long ${recentLongTasks.length}/5s · ${longTaskDuration.toFixed(0)} ms · max ${longTaskMax.toFixed(0)} ms`,
      `VIEW     ${renderStrategy}`,
      `CPU      ${lastRenderMs.toFixed(2)} ms · ${renderP95.toFixed(2)} p95`,
      `TRACK    ${trackingHz.toFixed(1)} Hz · ${lastInferenceMs.toFixed(1)} ms · ${snapshot.tracking.activity}`,
      `MOTION   ${(currentMotion?.speed ?? 0).toFixed(2)}/s · away ${Math.max(0, currentMotion?.recedingSpeed ?? 0).toFixed(2)}`,
      `DEPTH    ${snapshot.tracking.view.forward.toFixed(1)} → ${snapshot.tracking.target?.forward?.toFixed(1) ?? "--"} · v ${snapshot.tracking.velocity.forward.toFixed(2)}`,
      `FACE     size ${currentMotion?.size.toFixed(2) ?? "--"} · age ${faceSampleAge.toFixed(1)}s`,
      `CAPTURE  ${lastCaptureMs.toFixed(1)} ms · skip ${skippedInferenceFrames}`,
      `ENGINE   ${snapshot.tracking.detectorActive ? "MediaPipe" : "Idle"} · ${lastInputSize}`,
    ].join("\n")

    if (logElement && panelElement.dataset.debugRecording === "true") {
      const view = snapshot.tracking.view
      const target = snapshot.tracking.target
      const error = snapshot.tracking.error
      logElement.textContent = [
        `MEDIA time=${video.currentTime.toFixed(2)}s duration=${Number.isFinite(video.duration) ? video.duration.toFixed(2) : "--"}s rate=${video.playbackRate.toFixed(2)} paused=${video.paused} seeking=${video.seeking} ended=${video.ended}`,
        `BUFFER ready=${video.readyState} network=${video.networkState} ahead=${bufferedAhead.toFixed(2)}s waiting=${waitingEvents} stalled=${stalledEvents} total=${bufferingMs.toFixed(0)}ms last=${lastMediaEvent}@${Math.max(0, sampleNow - lastMediaEventAt).toFixed(0)}ms`,
        `DECODE source=${video.videoWidth}×${video.videoHeight}@${videoFrameRateLabel}fps dropped=${playbackQuality?.dropped ?? "--"}/${playbackQuality?.total ?? "--"} sample=${droppedSinceSample}/${decodedSinceSample} processP95=${processingP95.toFixed(2)}ms qualityApi=${Boolean(playbackQuality)}`,
        `CALLBACK rate=${callbackRate.toFixed(1)}Hz intervalP95=${callbackP95.toFixed(2)}ms lateP95=${callbackLateP95.toFixed(2)}ms gaps=${videoCallbackFrameGaps} rvfc=${"requestVideoFrameCallback" in video}`,
        `RENDER target=${snapshot.frameRate}fps actual=${fps}fps frameP95=${p95.toFixed(2)}ms cpuP95=${renderP95.toFixed(2)}ms schedulerSkips=${scheduledRenderSkips} deadlineMisses=${missedRenderDeadlines} deadlineLateP95=${deadlineLateP95.toFixed(2)}ms`,
        `WORKLOAD faceCenter=${snapshot.faceAutoCenter} tracking=${trackingHz.toFixed(1)}Hz inferenceP95=${inferenceP95.toFixed(2)}ms capture=${lastCaptureMs.toFixed(2)}ms activity=${snapshot.tracking.activity}`,
        `CENTER phase=${snapshot.tracking.phase} mode=${target?.mode ?? "--"} moving=${snapshot.tracking.isMoving} rescan=${snapshot.tracking.rescanDuringMovement} retry=${Math.max(0, snapshot.tracking.retryAt - sampleNow).toFixed(0)}ms view=${view.yaw.toFixed(2)},${view.pitch.toFixed(2)},${view.forward.toFixed(2)} target=${target?.yaw?.toFixed(2) ?? "--"},${target?.pitch?.toFixed(2) ?? "--"},${target?.forward?.toFixed(2) ?? "--"} error=${error?.yaw.toFixed(2) ?? "--"},${error?.pitch.toFixed(2) ?? "--"},${error?.forward.toFixed(2) ?? "--"} blocked=${snapshot.tracking.blockedAxis ?? "--"}`,
        `MAIN longTasks=${recentLongTasks.length}/5s total=${longTaskDuration.toFixed(0)}ms max=${longTaskMax.toFixed(0)}ms`,
        `ENV projection=${snapshot.projection} viewport=${snapshot.viewport.width}×${snapshot.viewport.height} canvas=${snapshot.canvas.width}×${snapshot.canvas.height} dpr=${snapshot.canvas.pixelRatio.toFixed(2)} quality=${snapshot.quality} split=${snapshot.splitCount} gpu=${gpuRenderer}`,
      ].join("\n")
    }

    lastPlaybackQuality = playbackQuality
    videoCallbackCount = 0
    scheduledRenderSkips = 0
    missedRenderDeadlines = 0
    fpsFrameCount = 0
    fpsSampleStartedAt = sampleNow
  }

  return {
    setEnabled(nextEnabled) {
      if (destroyed || nextEnabled === enabled) return
      enabled = nextEnabled
      if (enabled) start()
      else stop()
    },
    recordMediaEvent(name, at = readNow()) {
      if (!enabled) return
      lastMediaEvent = name
      lastMediaEventAt = at
    },
    recordPlaying(at = readNow()) {
      if (!enabled) return
      if (bufferingStartedAt !== undefined) {
        bufferingDurationMs += at - bufferingStartedAt
        bufferingStartedAt = undefined
      }
      lastMediaEvent = "playing"
      lastMediaEventAt = at
    },
    recordWaiting(at = readNow()) {
      if (!enabled) return
      waitingEvents += 1
      bufferingStartedAt ??= at
      lastMediaEvent = "waiting"
      lastMediaEventAt = at
    },
    recordStalled(at = readNow()) {
      if (!enabled) return
      stalledEvents += 1
      lastMediaEvent = "stalled"
      lastMediaEventAt = at
    },
    recordVideoFrame(callbackNow, metadata) {
      if (!enabled) return
      videoCallbackCount += 1
      if (previousVideoCallbackAt !== undefined) recentVideoCallbackIntervals.push(callbackNow - previousVideoCallbackAt)
      previousVideoCallbackAt = callbackNow
      recentVideoCallbackLateness.push(Math.max(0, callbackNow - metadata.expectedDisplayTime))
      if (metadata.processingDuration !== undefined) recentVideoProcessingTimes.push(metadata.processingDuration * 1000)
      if (previousPresentedFrames !== undefined) {
        videoCallbackFrameGaps += Math.max(0, metadata.presentedFrames - previousPresentedFrames - 1)
      }
      if (previousVideoMediaTime !== undefined && previousPresentedFrames !== undefined) {
        const mediaDelta = metadata.mediaTime - previousVideoMediaTime
        const frameDelta = metadata.presentedFrames - previousPresentedFrames
        const frameRate = frameDelta / mediaDelta
        if (mediaDelta > 0 && mediaDelta <= 1 && frameDelta > 0 && frameRate >= 1 && frameRate <= 240) {
          recentVideoFrameRates.push(frameRate)
          if (recentVideoFrameRates.length > 60) recentVideoFrameRates.shift()
          const sortedFrameRates = [...recentVideoFrameRates].sort((a, b) => a - b)
          videoSourceFrameRate = sortedFrameRates[Math.floor(sortedFrameRates.length / 2)]
        }
      }
      previousVideoMediaTime = metadata.mediaTime
      previousPresentedFrames = metadata.presentedFrames
      if (recentVideoCallbackIntervals.length > 180) recentVideoCallbackIntervals.shift()
      if (recentVideoCallbackLateness.length > 180) recentVideoCallbackLateness.shift()
      if (recentVideoProcessingTimes.length > 180) recentVideoProcessingTimes.shift()
    },
    recordSchedule(sample) {
      if (!enabled) return
      if (!sample.rendered) {
        scheduledRenderSkips += 1
        return
      }
      if (sample.deadlineLatenessMs === undefined) return
      recentRenderDeadlineLateness.push(sample.deadlineLatenessMs)
      if (recentRenderDeadlineLateness.length > 180) recentRenderDeadlineLateness.shift()
      if (sample.deadlineLatenessMs > (1000 / Math.max(1, sample.targetFrameRate)) * 0.5) {
        missedRenderDeadlines += 1
      }
    },
    recordRenderedFrame(sample) {
      if (!enabled) return
      lastRenderMs = sample.renderMs
      recentRenderTimes.push(sample.renderMs)
      if (recentRenderTimes.length > 180) recentRenderTimes.shift()
      updateMetrics(sample.now, sample.frameTimeMs)
    },
    recordTracking(event) {
      if (!enabled) return
      if (event.type === "capture") {
        lastCaptureMs = event.durationMs
        lastInputSize = event.inputSize
      } else if (event.type === "inference") {
        lastInferenceMs = event.durationMs
        recentInferenceTimes.push(event.durationMs)
        if (recentInferenceTimes.length > 20) recentInferenceTimes.shift()
        recentInferenceCompletions.push(event.completedAt)
      } else {
        skippedInferenceFrames += 1
      }
    },
    resetCadence,
    resetPlayback,
    resetVideoFrameMetrics,
    resetMedia() {
      resetPlayback()
      resetVideoFrameMetrics()
      resetRenderMetrics()
    },
    destroy() {
      if (destroyed) return
      destroyed = true
      enabled = false
      longTaskObserver?.disconnect()
      longTaskObserver = undefined
    },
  }
}
