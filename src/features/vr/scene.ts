import type { CameraView, ProjectionMode, ProjectionQuality } from "./config"
import type { FaceAutoCenterController } from "./tracking/face-auto-center-controller"
import type { FaceMovementHint } from "./tracking/face-center-movement"
import { DEFAULT_FOV, DEFAULT_ZOOM, PROJECTION_OPTIONS, QUALITY_OPTIONS } from "./config"
import { createManualViewInput } from "./control/manual-view-input"
import { scheduleFrame } from "./rendering/render-cadence-policy"
import { createVrRenderRuntime } from "./rendering/vr-render-runtime"
import { createFaceAutoCenterController } from "./tracking/face-auto-center-controller"
import { createVrDiagnostics } from "./vr-diagnostics"

export { DEFAULT_FOV, DEFAULT_ZOOM, PROJECTION_OPTIONS, QUALITY_OPTIONS }
export type { CameraView, ProjectionMode, ProjectionQuality }

export interface MutableRefObject<T> { current: T }
export interface ProjectionBoundaryWarning {
  axis: "yaw" | "pitch" | "forward"
  source: "auto" | "manual"
}

const SPHERE_SURFACE_DISTANCE = 100
const FLAT_SURFACE_DISTANCE = 65

const createFaceMovementOverlay = (element: HTMLElement, isEnabled: () => boolean) => {
  const horizontalGroup = element.querySelector<HTMLElement>("[data-face-horizontal-group]")
  const horizontalIcon = element.querySelector<HTMLElement>("[data-face-horizontal-icon]")
  const horizontalValue = element.querySelector<HTMLElement>("[data-face-horizontal-value]")
  const verticalGroup = element.querySelector<HTMLElement>("[data-face-vertical-group]")
  const verticalIcon = element.querySelector<HTMLElement>("[data-face-vertical-icon]")
  const verticalValue = element.querySelector<HTMLElement>("[data-face-vertical-value]")
  const depthGroup = element.querySelector<HTMLElement>("[data-face-depth-group]")
  const depthTarget = element.querySelector<HTMLElement>("[data-face-depth-target]")
  const depthValue = element.querySelector<HTMLElement>("[data-face-depth-value]")
  let visible = !element.hidden
  let lastText = element.getAttribute("aria-label") ?? ""
  let lastDepth: "nearer" | "farther" | undefined

  const hide = () => {
    if (!visible) return
    element.hidden = true
    visible = false
  }

  return {
    setHint(nextHint?: FaceMovementHint) {
      const hint = isEnabled() ? nextHint : undefined
      if (!hint) {
        hide()
        return
      }
      if (lastText !== hint.text) {
        element.setAttribute("aria-label", hint.text)
        lastText = hint.text
      }
      horizontalGroup?.classList.toggle("hidden", !hint.horizontal)
      horizontalGroup?.classList.toggle("flex", Boolean(hint.horizontal))
      if (horizontalIcon) horizontalIcon.textContent = hint.horizontal?.direction === "right" ? "→" : "←"
      if (horizontalValue) horizontalValue.textContent = hint.horizontal?.value ?? ""
      verticalGroup?.classList.toggle("hidden", !hint.vertical)
      verticalGroup?.classList.toggle("flex", Boolean(hint.vertical))
      if (verticalIcon) verticalIcon.textContent = hint.vertical?.direction === "up" ? "↑" : "↓"
      if (verticalValue) verticalValue.textContent = hint.vertical?.value ?? ""
      if (lastDepth !== hint.depth) {
        depthGroup?.classList.toggle("hidden", !hint.depth)
        depthGroup?.classList.toggle("flex", Boolean(hint.depth))
        if (depthTarget && hint.depth) {
          depthTarget.style.transform = `scale(${hint.depth === "nearer" ? 1.45 : 0.62})`
        }
        lastDepth = hint.depth
      }
      if (depthValue) depthValue.textContent = hint.depthValue ?? ""
      if (!visible) {
        element.hidden = false
        visible = true
      }
    },
    hide,
  }
}

export interface VrSceneOptions {
  root: HTMLElement
  mount: HTMLElement
  sampleCanvas: HTMLCanvasElement
  hintElement: HTMLElement
  fpsElement: HTMLElement
  video: HTMLVideoElement | null
  projection: ProjectionMode
  quality: ProjectionQuality
  frameRate: number
  hidden: boolean
  splitScreen: boolean
  faceAutoCenter: boolean
  resumeFaceAutoCenterAfterViewChange: boolean
  debugPanelOpen: boolean
  viewRef: MutableRefObject<CameraView>
  onFaceAutoCenterPauseChange: (paused: boolean) => void
  onProjectionBoundaryWarning: (warning: ProjectionBoundaryWarning) => void
}

export interface VrSceneController {
  update: (nextOptions: Partial<Pick<VrSceneOptions, "projection" | "quality" | "frameRate" | "hidden" | "splitScreen" | "faceAutoCenter" | "resumeFaceAutoCenterAfterViewChange" | "debugPanelOpen">>) => void
  getOutputCanvas: () => HTMLCanvasElement
  setFrameCapture: (capture?: (canvas: HTMLCanvasElement) => void) => void
  adjustForward: (direction: number) => void
  pauseFaceAutoCenter: () => void
  resumeFaceAutoCenter: () => void
  clearMediaFrame: () => void
  resetMedia: () => void
  destroy: () => void
}

export const createVrScene = (initialOptions: VrSceneOptions): VrSceneController | undefined => {
  if (!initialOptions.video) return undefined

  const mount = initialOptions.mount
  const sampleCanvas = initialOptions.sampleCanvas
  const video = initialOptions.video
  const options = { ...initialOptions, video }
  const movementOverlay = createFaceMovementOverlay(options.hintElement, () => options.debugPanelOpen)
  let disposed = false
  let frameId = 0
  let videoFrameCallbackId = 0
  let pendingVideoFrameAt: number | undefined
  let frameCapture: ((canvas: HTMLCanvasElement) => void) | undefined
  let lastFrameAt = performance.now()
  let nextPlaybackFrameAt: number | undefined
  const renderRuntime = createVrRenderRuntime({
    video,
    mount,
    projection: () => options.projection,
    quality: () => options.quality,
    splitScreen: () => options.splitScreen,
    viewRef: options.viewRef,
  })
  const { camera } = renderRuntime
  const applyRenderQuality = () => renderRuntime.setQuality(options.quality)

  const getFaceSurfaceDistance = (projection: ProjectionMode) =>
    projection === "flat_2d" ? FLAT_SURFACE_DISTANCE : SPHERE_SURFACE_DISTANCE
  let autoCenter!: FaceAutoCenterController

  const hasCurrentVideoFrame = () =>
    video.videoWidth > 0
    && video.videoHeight > 0
    && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA

  const stopScheduledRender = () => {
    if (frameId) {
      window.cancelAnimationFrame(frameId)
      frameId = 0
    }
  }

  function requestRender() {
    if (disposed || frameId || document.hidden || options.hidden || !hasCurrentVideoFrame()) return
    frameId = window.requestAnimationFrame(render)
  }

  const diagnostics = createVrDiagnostics({
    video,
    panelElement: options.fpsElement,
    getGpuLabel: renderRuntime.getGpuLabel,
    getSnapshot: () => {
      const tracking = autoCenter.snapshot()
      return {
        projection: options.projection,
        quality: options.quality,
        frameRate: options.frameRate,
        splitCount: renderRuntime.getSplitCount(),
        viewport: { width: mount.clientWidth, height: mount.clientHeight },
        canvas: renderRuntime.getCanvasMetrics(),
        faceAutoCenter: options.faceAutoCenter,
        tracking: {
          ...tracking,
          view: {
            yaw: options.viewRef.current.yaw,
            pitch: options.viewRef.current.pitch,
            forward: options.viewRef.current.forward,
          },
        },
      }
    },
  })
  autoCenter = createFaceAutoCenterController({
    video,
    camera,
    sampleCanvas,
    capture: {
      captureViewport: renderRuntime.captureViewportInference,
      capturePanoramaTile: renderRuntime.capturePanoramaTile,
    },
    getProjection: () => options.projection,
    getFrameRate: () => options.frameRate,
    getView: () => options.viewRef.current,
    getEnabled: () => options.faceAutoCenter,
    getHidden: () => options.hidden,
    getResumeAfterViewChange: () => options.resumeFaceAutoCenterAfterViewChange,
    getDebugEnabled: () => options.debugPanelOpen,
    getSurfaceDistance: getFaceSurfaceDistance,
    onDiagnosticEvent: diagnostics.recordTracking,
    onOverlayHint: movementOverlay.setHint,
    onPauseChange: options.onFaceAutoCenterPauseChange,
    onBoundaryWarning: axis => options.onProjectionBoundaryWarning({ axis, source: "auto" }),
    requestRender,
  })
  diagnostics.setEnabled(options.debugPanelOpen)

  const updateVisibility = () => {
    options.root.classList.toggle("opacity-0", options.hidden)
    options.root.classList.toggle("opacity-100", !options.hidden)
    options.root.setAttribute("aria-hidden", String(options.hidden))
    options.sampleCanvas.classList.toggle("hidden", !options.debugPanelOpen || !options.faceAutoCenter)
    options.fpsElement.classList.toggle("hidden", !options.debugPanelOpen)
    if (!options.debugPanelOpen) {
      movementOverlay.hide()
    }
  }

  const resize = () => {
    renderRuntime.resize()
    requestRender()
  }

  const rebuildProjection = () => {
    renderRuntime.setProjection(options.projection)
  }

  const onMetadata = () => {
    renderRuntime.invalidateTexture()
    pendingVideoFrameAt = undefined
    diagnostics.resetVideoFrameMetrics()
    diagnostics.resetPlayback()
    diagnostics.recordMediaEvent("loadedmetadata")
    rebuildProjection()
    autoCenter.handleMetadata()
    requestRender()
  }
  video.addEventListener("loadedmetadata", onMetadata)

  const onVideoActivity = (event: Event) => {
    if (event.type === "seeked") {
      pendingVideoFrameAt = undefined
      nextPlaybackFrameAt = undefined
      lastFrameAt = performance.now()
    }
    if (event.type === "playing") {
      diagnostics.recordPlaying()
      autoCenter.prefetchResources()
    } else {
      diagnostics.recordMediaEvent(event.type)
    }
    autoCenter.requestDetection()
    requestRender()
  }
  const onVideoPause = () => {
    diagnostics.recordMediaEvent("pause")
    autoCenter.handleVideoPause()
  }
  const onVideoSeeking = () => {
    pendingVideoFrameAt = undefined
    diagnostics.resetVideoFrameMetrics()
    nextPlaybackFrameAt = undefined
    lastFrameAt = performance.now()
    diagnostics.recordMediaEvent("seeking")
  }
  const onVideoWaiting = () => diagnostics.recordWaiting()
  const onVideoStalled = () => diagnostics.recordStalled()
  const onVideoError = () => diagnostics.recordMediaEvent(`error:${video.error?.code ?? "unknown"}`)
  video.addEventListener("playing", onVideoActivity)
  video.addEventListener("pause", onVideoPause)
  video.addEventListener("seeking", onVideoSeeking)
  video.addEventListener("seeked", onVideoActivity)
  video.addEventListener("loadeddata", onVideoActivity)
  video.addEventListener("waiting", onVideoWaiting)
  video.addEventListener("stalled", onVideoStalled)
  video.addEventListener("error", onVideoError)

  const resetRenderCadence = (event: "focus" | "visible") => {
    diagnostics.recordMediaEvent(event)
    pendingVideoFrameAt = undefined
    nextPlaybackFrameAt = undefined
    diagnostics.resetCadence()
    lastFrameAt = performance.now()
    autoCenter.requestDetection()
    requestRender()
  }
  const onVisibilityChange = () => {
    if (document.hidden) {
      diagnostics.recordMediaEvent("hidden")
      autoCenter.invalidateInference()
      pendingVideoFrameAt = undefined
      nextPlaybackFrameAt = undefined
      diagnostics.resetCadence()
      stopScheduledRender()
      return
    }
    resetRenderCadence("visible")
  }
  const onWindowFocus = () => {
    if (!document.hidden) resetRenderCadence("focus")
  }
  const onWindowBlur = () => diagnostics.recordMediaEvent("blur")
  document.addEventListener("visibilitychange", onVisibilityChange)
  window.addEventListener("focus", onWindowFocus)
  window.addEventListener("blur", onWindowBlur)

  if ("requestVideoFrameCallback" in video) {
    const onVideoFrame = (now: DOMHighResTimeStamp, metadata: VideoFrameCallbackMetadata) => {
      if (disposed) return
      pendingVideoFrameAt = metadata.mediaTime * 1000
      diagnostics.recordVideoFrame(now, metadata)
      videoFrameCallbackId = video.requestVideoFrameCallback(onVideoFrame)
      requestRender()
    }
    videoFrameCallbackId = video.requestVideoFrameCallback(onVideoFrame)
  }

  const resizeObserver = new ResizeObserver(resize)
  resizeObserver.observe(mount)

  const manualInput = createManualViewInput({
    element: renderRuntime.canvas,
    camera,
    getView: () => options.viewRef.current,
    getProjection: () => options.projection,
    getSurfaceDistance: () => getFaceSurfaceDistance(options.projection),
    getViewportHeight: () => mount.clientHeight,
    isDebugEnabled: () => options.debugPanelOpen,
    onBoundaryWarning: axis => options.onProjectionBoundaryWarning({ axis, source: "manual" }),
    onEffectiveViewChange: autoCenter.pauseForManualInput,
    requestRender,
  })

  function render(now: number) {
    if (disposed) return
    frameId = 0
    const videoFrameAt = pendingVideoFrameAt
    pendingVideoFrameAt = undefined
    const videoFrameDriven = videoFrameAt !== undefined && !manualInput.isInteracting() && !autoCenter.isMoving()
    const scheduleMode = manualInput.isInteracting() || autoCenter.isMoving() || (("requestVideoFrameCallback" in video) && !videoFrameDriven)
      ? "interaction"
      : "playback"
    const scheduleNow = videoFrameDriven ? videoFrameAt : now
    const playbackDeadline = nextPlaybackFrameAt
    const schedule = scheduleFrame(scheduleNow, options.frameRate, nextPlaybackFrameAt, scheduleMode)
    nextPlaybackFrameAt = schedule.nextFrameAt
    if (!schedule.render) {
      diagnostics.recordSchedule({ rendered: false, targetFrameRate: options.frameRate })
      if (!("requestVideoFrameCallback" in video)) requestRender()
      return
    }
    const deadlineLateness = scheduleMode === "playback" && playbackDeadline !== undefined
      ? Math.max(0, scheduleNow - playbackDeadline)
      : undefined
    diagnostics.recordSchedule({
      rendered: true,
      deadlineLatenessMs: deadlineLateness,
      targetFrameRate: options.frameRate,
    })
    const delta = (now - lastFrameAt) / 1000
    lastFrameAt = now
    renderRuntime.applyCameraPose()
    const renderStartedAt = options.debugPanelOpen ? performance.now() : 0
    renderRuntime.renderVisibleViewports()
    frameCapture?.(renderRuntime.canvas)
    if (options.debugPanelOpen) {
      diagnostics.recordRenderedFrame({
        now,
        frameTimeMs: delta * 1000,
        renderMs: performance.now() - renderStartedAt,
      })
    }
    // Sample immediately after rendering so WebGL does not need an expensive
    // preserveDrawingBuffer allocation just for face tracking.
    autoCenter.runAfterRender(now, delta)

    if (options.hidden || video.paused || !hasCurrentVideoFrame()) return
    if (manualInput.isInteracting() || autoCenter.isMoving()) {
      requestRender()
      return
    }
    if (!("requestVideoFrameCallback" in video)) requestRender()
  }

  updateVisibility()
  requestRender()

  return {
    getOutputCanvas: () => renderRuntime.canvas,
    setFrameCapture: capture => (frameCapture = capture),
    adjustForward: direction => manualInput.adjustForward(direction),
    pauseFaceAutoCenter: autoCenter.pauseForManualInput,
    resumeFaceAutoCenter: autoCenter.resume,
    clearMediaFrame() {
      stopScheduledRender()
      pendingVideoFrameAt = undefined
      nextPlaybackFrameAt = undefined
      renderRuntime.clearMediaFrame()
    },
    update(nextOptions) {
      if (nextOptions.frameRate !== undefined && nextOptions.frameRate !== options.frameRate) {
        nextPlaybackFrameAt = undefined
        autoCenter.requestDetection()
      }
      const shouldRebuild = nextOptions.projection !== undefined
      const opensDebugPanel = nextOptions.debugPanelOpen === true && !options.debugPanelOpen
      const closesDebugPanel = nextOptions.debugPanelOpen === false && options.debugPanelOpen
      if (nextOptions.projection !== undefined || nextOptions.hidden !== undefined) {
        autoCenter.invalidateInference()
      }
      Object.assign(options, nextOptions)
      if (nextOptions.faceAutoCenter !== undefined) autoCenter.setEnabled(options.faceAutoCenter)
      if (opensDebugPanel || closesDebugPanel) diagnostics.setEnabled(options.debugPanelOpen)
      if (nextOptions.resumeFaceAutoCenterAfterViewChange !== undefined) {
        autoCenter.setResumeAfterViewChange(options.resumeFaceAutoCenterAfterViewChange)
      }
      if (nextOptions.quality !== undefined) {
        applyRenderQuality()
      }
      if (shouldRebuild) {
        rebuildProjection()
      }
      if (nextOptions.splitScreen !== undefined) resize()
      updateVisibility()
      if (options.hidden) {
        stopScheduledRender()
      } else {
        if (nextOptions.faceAutoCenter === true || nextOptions.projection !== undefined) {
          autoCenter.requestDetection()
        }
        requestRender()
      }
    },
    resetMedia() {
      autoCenter.resetMedia()
      stopScheduledRender()
      pendingVideoFrameAt = undefined
      diagnostics.resetMedia()
      renderRuntime.resetMedia()
    },
    destroy() {
      disposed = true
      stopScheduledRender()
      if (videoFrameCallbackId) video.cancelVideoFrameCallback(videoFrameCallbackId)
      video.removeEventListener("loadedmetadata", onMetadata)
      video.removeEventListener("playing", onVideoActivity)
      video.removeEventListener("pause", onVideoPause)
      video.removeEventListener("seeking", onVideoSeeking)
      video.removeEventListener("seeked", onVideoActivity)
      video.removeEventListener("loadeddata", onVideoActivity)
      video.removeEventListener("waiting", onVideoWaiting)
      video.removeEventListener("stalled", onVideoStalled)
      video.removeEventListener("error", onVideoError)
      document.removeEventListener("visibilitychange", onVisibilityChange)
      window.removeEventListener("focus", onWindowFocus)
      window.removeEventListener("blur", onWindowBlur)
      resizeObserver.disconnect()
      manualInput.destroy()
      autoCenter.destroy()
      diagnostics.destroy()
      renderRuntime.destroy()
    },
  }
}
