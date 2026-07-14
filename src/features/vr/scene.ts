import type { FaceInferenceMode, FaceInferenceResult } from "../face-tracking/protocol"
import type { CameraView, ProjectionMode, ProjectionQuality } from "./config"
import type { DetectionMode, FaceAutoCenterState, PanoramaSample } from "./face-auto-center"
import { Color, MathUtils, PerspectiveCamera, Scene, SRGBColorSpace, VideoTexture, WebGLRenderer } from "three"
import { getFaceTrackerClient } from "../face-tracking/client"
import {

  DEFAULT_FOV,

  projectionPixelRatio,
} from "./config"
import {
  applyDetections,

  getProjectionYawLimit,
  mapSampleFaceToPanorama,

  setPanoramaTarget,
  setViewportTarget,
} from "./face-auto-center"
import { drawPanoramaInferenceSample, drawSampleBoxes, drawViewportInferenceSample } from "./face-sampling"
import { faceInferencePeriod, scheduleFrame } from "./frame-scheduler"
import { createProjectionGroup, disposeObject } from "./projection"

export { downloadFaceTrackingResources, preloadFaceAutoCenterResources } from "../face-tracking/client"
export { DEFAULT_FOV, DEFAULT_ZOOM, PROJECTION_OPTIONS, QUALITY_OPTIONS } from "./config"
export type { CameraView, ProjectionMode, ProjectionQuality } from "./config"

export interface MutableRefObject<T> { current: T }

const MIN_ZOOM = 0.8
const MAX_ZOOM = 2.4
const WHEEL_ZOOM_SPEED = 0.0016
const TRACKPAD_PINCH_ZOOM_SPEED = 0.01
const VIEWPORT_TARGET_X = 0.5
const VIEWPORT_TARGET_Y = 1 / 3
const VIEWPORT_DEAD_ZONE_X = 0.04
const VIEWPORT_DEAD_ZONE_Y = 0.04
const PANORAMA_DIRECTION_ANCHOR_WEIGHT = 1.35
const FACE_TARGET_GRACE_MS = 900
const VIEWPORT_SAMPLE_WIDTH = 320
const PANORAMA_SAMPLE_WIDTH = 320
const MAX_SPLIT_SCREEN_PANELS = 3
const MIN_SPLIT_SCREEN_ASPECT = 9 / 16
const FACE_CENTER_RESPONSE = 0.65
const FACE_CENTER_MAX_SPEED = 5.5
const FACE_CENTER_VELOCITY_SMOOTHING_MS = 260
const FACE_CENTER_STOP_SPEED = 0.025

interface RenderViewport { x: number, y: number, width: number, height: number }

interface OverlayState {
  hint?: { side: "left" | "right", top: number, text: string }
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const shortestAngle = (degrees: number) => ((degrees + 540) % 360) - 180
const getViewportTanHalfVertical = (camera: PerspectiveCamera) =>
  Math.tan(MathUtils.degToRad(camera.fov) / 2) / camera.zoom
const getViewportYawOffset = (camera: PerspectiveCamera, x: number) =>
  MathUtils.radToDeg(Math.atan((1 - x * 2) * getViewportTanHalfVertical(camera) * camera.aspect))
const getViewportPitchOffset = (camera: PerspectiveCamera, y: number) =>
  MathUtils.radToDeg(Math.atan((1 - y * 2) * getViewportTanHalfVertical(camera)))

const getRenderViewports = (width: number, height: number, splitScreen: boolean): RenderViewport[] => {
  if (!splitScreen || width <= height) return [{ x: 0, y: 0, width, height }]

  const panelCount = Math.min(MAX_SPLIT_SCREEN_PANELS, Math.max(1, Math.floor(width / (height * MIN_SPLIT_SCREEN_ASPECT))))
  const panelWidth = width / panelCount

  return Array.from({ length: panelCount }, (_, index) => ({
    x: panelWidth * index,
    y: 0,
    width: panelWidth,
    height,
  }))
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
  debugPanelOpen: boolean
  viewRef: MutableRefObject<CameraView>
  onZoomChange: (zoom: number) => void
}

export interface VrSceneController {
  update: (nextOptions: Partial<Pick<VrSceneOptions, "projection" | "quality" | "frameRate" | "hidden" | "splitScreen" | "faceAutoCenter" | "debugPanelOpen">>) => void
  getOutputCanvas: () => HTMLCanvasElement
  setFrameCapture: (capture?: (canvas: HTMLCanvasElement) => void) => void
  resetMedia: () => void
  destroy: () => void
}

export const createVrScene = (initialOptions: VrSceneOptions): VrSceneController | undefined => {
  if (!initialOptions.video) return undefined

  const mount = initialOptions.mount
  const sampleCanvas = initialOptions.sampleCanvas
  const video = initialOptions.video
  const options = { ...initialOptions, video }
  let disposed = false
  let frameId = 0
  let videoFrameCallbackId = 0
  let frameCapture: ((canvas: HTMLCanvasElement) => void) | undefined
  let lastFrameAt = performance.now()
  let nextPlaybackFrameAt: number | undefined
  let fpsSampleStartedAt = lastFrameAt
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
  let overlayVisible = !options.hintElement.hidden
  let lastOverlayText = options.hintElement.textContent ?? ""
  let lastOverlaySide = options.hintElement.dataset.side
  let lastOverlayTop = Number.NaN
  const scene = new Scene()
  scene.background = new Color("#000")
  const initialViewport = getRenderViewports(
    Math.max(1, mount.clientWidth),
    Math.max(1, mount.clientHeight),
    options.splitScreen,
  )[0]
  const camera = new PerspectiveCamera(DEFAULT_FOV, initialViewport.width / initialViewport.height, 0.1, 1000)
  camera.zoom = options.viewRef.current.zoom
  camera.updateProjectionMatrix()
  const renderer = new WebGLRenderer({
    antialias: true,
    precision: "highp",
    powerPreference: "high-performance",
  })
  renderer.outputColorSpace = SRGBColorSpace
  renderer.domElement.className = "block h-dvh w-full touch-none saturate-105 contrast-102"
  const applyRenderQuality = () => {
    const pixelRatio = projectionPixelRatio(options.quality, window.devicePixelRatio || 1)
    renderer.setPixelRatio(pixelRatio)
    renderer.setSize(mount.clientWidth, mount.clientHeight, false)
    renderer.domElement.style.imageRendering = "auto"
    renderer.domElement.dataset.quality = options.quality
    renderer.domElement.dataset.pixelRatio = pixelRatio.toFixed(2)
  }
  applyRenderQuality()
  mount.appendChild(renderer.domElement)

  const texture = new VideoTexture(video)
  texture.colorSpace = SRGBColorSpace
  texture.needsUpdate = true
  let projection = createProjectionGroup(video, texture, options.projection, options.quality)
  scene.add(projection)

  const faceState: FaceAutoCenterState = {
    faces: [],
    detectionMode: "viewport",
    nextDetectionAt: 0,
    lastDetectionAt: 0,
    consecutiveMisses: 0,
    isMoving: false,
    yawVelocity: 0,
    pitchVelocity: 0,
    lastErrorAt: 0,
  }
  const sampleContext = sampleCanvas.getContext("2d", { alpha: false, willReadFrequently: true })
  const faceTracker = getFaceTrackerClient()
  let inferenceInFlight = false
  let inferenceGeneration = 0

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
    if (disposed || frameId || options.hidden || !hasCurrentVideoFrame()) return
    frameId = window.requestAnimationFrame(render)
  }

  const setOverlay = (overlay: OverlayState) => {
    const hint = options.debugPanelOpen ? overlay.hint : undefined
    if (hint) {
      if (lastOverlayText !== hint.text) {
        options.hintElement.textContent = hint.text
        lastOverlayText = hint.text
      }
      if (lastOverlaySide !== hint.side) {
        options.hintElement.dataset.side = hint.side
        options.hintElement.classList.toggle("left-3.5", hint.side === "left")
        options.hintElement.classList.toggle("right-3.5", hint.side === "right")
        lastOverlaySide = hint.side
      }
      if (!Number.isFinite(lastOverlayTop) || Math.abs(lastOverlayTop - hint.top) >= 0.1) {
        options.hintElement.style.top = `${hint.top}%`
        lastOverlayTop = hint.top
      }
      if (!overlayVisible) {
        options.hintElement.hidden = false
        overlayVisible = true
      }
    } else if (overlayVisible) {
      options.hintElement.hidden = true
      overlayVisible = false
    }
  }

  const updateVisibility = () => {
    options.root.classList.toggle("opacity-0", options.hidden)
    options.root.classList.toggle("opacity-100", !options.hidden)
    options.root.setAttribute("aria-hidden", String(options.hidden))
    options.sampleCanvas.classList.toggle("hidden", !options.debugPanelOpen || !options.faceAutoCenter)
    options.fpsElement.classList.toggle("hidden", !options.debugPanelOpen)
    if (!options.debugPanelOpen) {
      setOverlay({})
      options.fpsElement.textContent = "FPS --  P95 -- ms"
      fpsFrameCount = 0
      fpsSampleStartedAt = performance.now()
      recentFrameTimes.length = 0
      recentRenderTimes.length = 0
      lastRenderMs = 0
      recentInferenceCompletions = []
      lastInferenceMs = 0
      lastCaptureMs = 0
      lastInputSize = "--"
      skippedInferenceFrames = 0
    }
  }

  const updatePerformanceMetrics = (now: number, frameTimeMs: number) => {
    fpsFrameCount += 1
    if (frameTimeMs > 0 && frameTimeMs < 1000) {
      recentFrameTimes.push(frameTimeMs)
      if (recentFrameTimes.length > 180) recentFrameTimes.shift()
    }

    const elapsed = now - fpsSampleStartedAt
    if (elapsed < 500) return

    const fps = Math.max(1, Math.round((fpsFrameCount * 1000) / elapsed))
    const sortedFrameTimes = [...recentFrameTimes].sort((a, b) => a - b)
    const p95Index = Math.max(0, Math.ceil(sortedFrameTimes.length * 0.95) - 1)
    const p95 = sortedFrameTimes[p95Index] ?? 0
    const sortedRenderTimes = [...recentRenderTimes].sort((a, b) => a - b)
    const renderP95Index = Math.max(0, Math.ceil(sortedRenderTimes.length * 0.95) - 1)
    const renderP95 = sortedRenderTimes[renderP95Index] ?? 0
    recentInferenceCompletions = recentInferenceCompletions.filter(time => now - time <= 2000)
    const trackingSpan = recentInferenceCompletions.length > 1
      ? recentInferenceCompletions[recentInferenceCompletions.length - 1] - recentInferenceCompletions[0]
      : 0
    const trackingHz = trackingSpan > 0
      ? ((recentInferenceCompletions.length - 1) * 1000) / trackingSpan
      : 0

    const splitCount = getRenderViewports(mount.clientWidth, mount.clientHeight, options.splitScreen).length
    const renderStrategy = splitCount <= 1
      ? "Single view"
      : `Split ${splitCount} · render ${splitCount}×`

    options.fpsElement.textContent = [
      `FPS ${fps}  P95 ${p95.toFixed(1)} ms`,
      renderStrategy,
      `Render CPU ${lastRenderMs.toFixed(2)} ms  P95 ${renderP95.toFixed(2)} ms`,
      `Track ${trackingHz.toFixed(1)} Hz  Infer ${lastInferenceMs.toFixed(1)} ms`,
      `Capture ${lastCaptureMs.toFixed(1)} ms  Skipped ${skippedInferenceFrames}`,
      `${faceTracker.getBackendLabel()}  Input ${lastInputSize}`,
    ].join("\n")
    fpsFrameCount = 0
    fpsSampleStartedAt = now
  }

  const resize = () => {
    const width = Math.max(1, mount.clientWidth)
    const height = Math.max(1, mount.clientHeight)
    const primaryViewport = getRenderViewports(width, height, options.splitScreen)[0]
    camera.aspect = primaryViewport.width / primaryViewport.height
    camera.updateProjectionMatrix()
    renderer.setSize(width, height, false)
    requestRender()
  }

  const rebuildProjection = () => {
    scene.remove(projection)
    disposeObject(projection)
    projection = createProjectionGroup(video, texture, options.projection, options.quality)
    scene.add(projection)
  }

  const onMetadata = () => {
    texture.needsUpdate = true
    rebuildProjection()
    faceState.nextDetectionAt = 0
    requestRender()
  }
  video.addEventListener("loadedmetadata", onMetadata)

  const onVideoActivity = () => {
    faceState.nextDetectionAt = 0
    requestRender()
  }
  const onVideoPause = () => {
    inferenceGeneration += 1
    faceState.faces = []
    faceState.target = undefined
    faceState.recoveryMode = undefined
    faceState.yawVelocity = 0
    faceState.pitchVelocity = 0
    faceState.isMoving = false
    setOverlay({})
    requestRender()
  }
  video.addEventListener("playing", onVideoActivity)
  video.addEventListener("pause", onVideoPause)
  video.addEventListener("seeked", onVideoActivity)
  video.addEventListener("loadeddata", onVideoActivity)

  if ("requestVideoFrameCallback" in video) {
    const onVideoFrame = () => {
      if (disposed) return
      videoFrameCallbackId = video.requestVideoFrameCallback(onVideoFrame)
      requestRender()
    }
    videoFrameCallbackId = video.requestVideoFrameCallback(onVideoFrame)
  }

  const resizeObserver = new ResizeObserver(resize)
  resizeObserver.observe(mount)

  const pauseFaceCenter = () => {
    options.viewRef.current.pausedUntil = performance.now() + 1800
    faceState.nextDetectionAt = options.viewRef.current.pausedUntil
    faceState.yawVelocity = 0
    faceState.pitchVelocity = 0
    faceState.isMoving = false
    requestRender()
  }

  const dragging = { active: false, pointerId: 0, x: 0, y: 0 }
  const touchPoints = new Map<number, { x: number, y: number }>()
  let pinch: { pointerIds: [number, number], distance: number, zoom: number } | undefined

  const applyZoom = (nextZoom: number) => {
    const clampedZoom = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM)
    if (clampedZoom === options.viewRef.current.zoom) return
    options.viewRef.current.zoom = clampedZoom
    options.onZoomChange(clampedZoom)
    pauseFaceCenter()
    requestRender()
  }

  const startTouchPinch = () => {
    const points = Array.from(touchPoints.entries()).slice(0, 2)
    if (points.length < 2) {
      pinch = undefined
      return
    }
    const [[firstId, first], [secondId, second]] = points
    pinch = {
      pointerIds: [firstId, secondId],
      distance: Math.max(1, Math.hypot(second.x - first.x, second.y - first.y)),
      zoom: options.viewRef.current.zoom,
    }
    dragging.active = false
  }

  const onPointerDown = (event: PointerEvent) => {
    if (event.pointerType === "mouse" && event.button !== 0) return
    if (event.pointerType === "touch") {
      touchPoints.set(event.pointerId, { x: event.clientX, y: event.clientY })
      renderer.domElement.setPointerCapture?.(event.pointerId)
      if (touchPoints.size > 1) {
        startTouchPinch()
      } else {
        dragging.active = true
        dragging.pointerId = event.pointerId
        dragging.x = event.clientX
        dragging.y = event.clientY
      }
      pauseFaceCenter()
      requestRender()
      return
    }
    dragging.active = true
    dragging.pointerId = event.pointerId
    dragging.x = event.clientX
    dragging.y = event.clientY
    renderer.domElement.setPointerCapture?.(event.pointerId)
    pauseFaceCenter()
    requestRender()
  }
  const onPointerMove = (event: PointerEvent) => {
    if (event.pointerType === "touch" && touchPoints.has(event.pointerId)) {
      touchPoints.set(event.pointerId, { x: event.clientX, y: event.clientY })
      if (pinch) {
        const [firstId, secondId] = pinch.pointerIds
        const first = touchPoints.get(firstId)
        const second = touchPoints.get(secondId)
        if (!first || !second) {
          startTouchPinch()
          return
        }
        const distance = Math.max(1, Math.hypot(second.x - first.x, second.y - first.y))
        applyZoom(pinch.zoom * distance / pinch.distance)
        return
      }
    }
    if (!dragging.active || dragging.pointerId !== event.pointerId) return
    if (event.pointerType === "mouse" && (event.buttons & 1) === 0) {
      dragging.active = false
      if (renderer.domElement.hasPointerCapture?.(event.pointerId)) renderer.domElement.releasePointerCapture?.(event.pointerId)
      requestRender()
      return
    }
    const dx = event.clientX - dragging.x
    const dy = event.clientY - dragging.y
    dragging.x = event.clientX
    dragging.y = event.clientY
    options.viewRef.current.yaw += dx * 0.08
    options.viewRef.current.pitch = clamp(options.viewRef.current.pitch + dy * 0.08, -85, 85)
    requestRender()
  }
  const onPointerUp = (event: PointerEvent) => {
    if (event.pointerType === "touch" && touchPoints.has(event.pointerId)) {
      touchPoints.delete(event.pointerId)
      if (renderer.domElement.hasPointerCapture?.(event.pointerId)) renderer.domElement.releasePointerCapture?.(event.pointerId)
      pinch = undefined
      if (touchPoints.size > 1) {
        startTouchPinch()
      } else {
        const remaining = touchPoints.entries().next().value as [number, { x: number, y: number }] | undefined
        dragging.active = Boolean(remaining)
        if (remaining) {
          dragging.pointerId = remaining[0]
          dragging.x = remaining[1].x
          dragging.y = remaining[1].y
        }
      }
      requestRender()
      return
    }
    if (!dragging.active || dragging.pointerId !== event.pointerId) return
    dragging.active = false
    if (renderer.domElement.hasPointerCapture?.(event.pointerId)) renderer.domElement.releasePointerCapture?.(event.pointerId)
    requestRender()
  }
  const onWheel = (event: WheelEvent) => {
    event.preventDefault()
    const deltaScale = event.deltaMode === WheelEvent.DOM_DELTA_LINE
      ? 16
      : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
        ? mount.clientHeight
        : 1
    const speed = event.ctrlKey ? TRACKPAD_PINCH_ZOOM_SPEED : WHEEL_ZOOM_SPEED
    applyZoom(options.viewRef.current.zoom * Math.exp(-event.deltaY * deltaScale * speed))
  }

  renderer.domElement.addEventListener("pointerdown", onPointerDown)
  renderer.domElement.addEventListener("pointermove", onPointerMove)
  renderer.domElement.addEventListener("pointerup", onPointerUp)
  renderer.domElement.addEventListener("pointercancel", onPointerUp)
  renderer.domElement.addEventListener("wheel", onWheel, { passive: false })

  const updateInferenceSchedule = (now: number, completedInferenceMs = 0) => {
    const sortedInferenceTimes = [...recentInferenceTimes].sort((a, b) => a - b)
    const p95Index = Math.max(0, Math.ceil(sortedInferenceTimes.length * 0.95) - 1)
    const inferenceP95 = sortedInferenceTimes[p95Index] ?? 0
    const adaptivePeriod = faceInferencePeriod(options.frameRate, inferenceP95)
    // Keep the adaptive period measured from inference start to inference start.
    faceState.nextDetectionAt = now + Math.max(0, adaptivePeriod - completedInferenceMs)
  }

  const updateTrackingResult = (foundFace: boolean, time: number) => {
    if (foundFace) {
      faceState.consecutiveMisses = 0
      return
    }

    faceState.consecutiveMisses += 1
    if (faceState.target && time - faceState.target.lastSeenAt > FACE_TARGET_GRACE_MS) {
      faceState.target = undefined
    }
    if (faceState.consecutiveMisses >= 3 && !faceState.target) {
      faceState.selectedFace = undefined
    }
  }

  const applyInferenceResult = (
    result: FaceInferenceResult,
    detectionMode: DetectionMode,
    panoramaSample: PanoramaSample | undefined,
    projection: ProjectionMode,
  ) => {
    const time = result.timestamp
    const completedAt = performance.now()
    lastInferenceMs = result.inferenceMs
    recentInferenceTimes.push(result.inferenceMs)
    if (recentInferenceTimes.length > 20) recentInferenceTimes.shift()
    // These timestamps only feed the debug meter. Keeping them while the meter
    // is closed would make the array grow for the entire playback session.
    if (options.debugPanelOpen) recentInferenceCompletions.push(completedAt)
    let foundFace = false

    if (result.mode === "landmarks") {
      const normalizedFace = result.faces[0]
      const face = normalizedFace ? { ...normalizedFace, lastSeenAt: time } : undefined
      faceState.lastDetectionAt = time
      faceState.detectionMode = "viewport"
      faceState.faces = face ? [face] : []
      faceState.selectedFace = face ? { ...face, mode: "viewport" } : faceState.selectedFace
      foundFace = setViewportTarget(faceState, face, time, result.center)
      faceState.recoveryMode = foundFace ? undefined : "viewport"
    } else if (detectionMode === "panorama" && panoramaSample) {
      faceState.detectionMode = "panorama"
      const face = applyDetections(faceState, result.faces, time, "panorama", {
        x: panoramaSample.center.x,
        y: panoramaSample.center.y,
        weight: PANORAMA_DIRECTION_ANCHOR_WEIGHT,
        wrapX: panoramaSample.wraps,
      }, sampleFace => mapSampleFaceToPanorama(sampleFace, panoramaSample))
      foundFace = setPanoramaTarget(faceState, face, time, projection, camera)
      faceState.recoveryMode = undefined
    } else {
      faceState.detectionMode = "viewport"
      const face = applyDetections(faceState, result.faces, time, "viewport")
      foundFace = setViewportTarget(faceState, face, time)
      faceState.recoveryMode = foundFace ? undefined : "panorama"
    }

    updateTrackingResult(foundFace, time)
    if (options.debugPanelOpen) {
      drawSampleBoxes(faceState, sampleCanvas, sampleContext!, performance.now(), faceState.detectionMode)
    }
  }

  const submitInference = (now: number) => {
    if (!sampleContext || inferenceInFlight) return

    const captureStartedAt = performance.now()
    let mode: FaceInferenceMode = "landmarks"
    let detectionMode: DetectionMode = "viewport"
    let panoramaSample: PanoramaSample | undefined
    let inputWidth = 0
    let inputHeight = 0
    let completedInferenceMs = 0
    const projection = options.projection

    try {
      if (faceState.recoveryMode === "panorama") {
        mode = "detection"
        detectionMode = "panorama"
        panoramaSample = drawPanoramaInferenceSample(
          sampleCanvas,
          sampleContext,
          video,
          PANORAMA_SAMPLE_WIDTH,
          projection,
          options.viewRef.current,
          camera,
        )
        if (!panoramaSample) return
        inputWidth = sampleCanvas.width
        inputHeight = sampleCanvas.height
      } else {
        mode = faceState.recoveryMode === "viewport" ? "detection" : "landmarks"
        const renderViewports = getRenderViewports(renderer.domElement.width, renderer.domElement.height, options.splitScreen)
        const sourceRect = renderViewports[Math.floor(renderViewports.length / 2)]
        // Copy synchronously into the small reusable canvas. Creating an
        // ImageBitmap directly from the WebGL canvas can retain its full-size
        // backing buffer until the asynchronous capture has completed.
        const size = drawViewportInferenceSample(
          sampleCanvas,
          sampleContext,
          renderer.domElement,
          sourceRect.x,
          sourceRect.y,
          sourceRect.width,
          sourceRect.height,
          VIEWPORT_SAMPLE_WIDTH,
        )
        if (!size) return
        inputWidth = size.width
        inputHeight = size.height
      }
    } catch (error) {
      if (now - faceState.lastErrorAt > 3000) {
        faceState.lastErrorAt = now
        console.warn("face auto center could not capture inference frame", error)
      }
      updateInferenceSchedule(now)
      return
    }

    const generation = inferenceGeneration
    lastInputSize = `${inputWidth}×${inputHeight}`
    inferenceInFlight = true
    updateInferenceSchedule(now)
    void createImageBitmap(sampleCanvas)
      .then((bitmap) => {
        lastCaptureMs = performance.now() - captureStartedAt
        return faceTracker.infer(mode, bitmap, now, detectionMode === "viewport" ? "short" : "full")
      })
      .then((result) => {
        completedInferenceMs = result.inferenceMs
        if (disposed || generation !== inferenceGeneration || video.paused || !options.faceAutoCenter || options.hidden) return
        applyInferenceResult(result, detectionMode, panoramaSample, projection)
      })
      .catch((error) => {
        if (disposed || generation !== inferenceGeneration) return
        if (performance.now() - faceState.lastErrorAt > 3000) {
          faceState.lastErrorAt = performance.now()
          console.warn("face tracking worker inference failed", error)
        }
      })
      .finally(() => {
        inferenceInFlight = false
        if (!disposed && generation === inferenceGeneration) {
          updateInferenceSchedule(performance.now(), completedInferenceMs)
          requestRender()
        }
      })
  }

  const runFaceAutoCenter = (now: number, delta: number) => {
    if (!sampleContext) return

    if (video.paused) {
      faceState.yawVelocity = 0
      faceState.pitchVelocity = 0
      faceState.isMoving = false
      setOverlay({})
      return
    }

    if (!options.faceAutoCenter || options.hidden) {
      faceState.faces = []
      faceState.target = undefined
      faceState.recoveryMode = undefined
      faceState.consecutiveMisses = 0
      faceState.yawVelocity = 0
      faceState.pitchVelocity = 0
      faceState.isMoving = false
      setOverlay({})
      return
    }

    if (!video.videoWidth || !video.videoHeight || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      faceState.faces = []
      faceState.target = undefined
      faceState.recoveryMode = undefined
      faceState.yawVelocity = 0
      faceState.pitchVelocity = 0
      faceState.isMoving = false
      setOverlay({})
      return
    }

    if (now < options.viewRef.current.pausedUntil) return

    if (now >= faceState.nextDetectionAt) {
      if (inferenceInFlight) {
        skippedInferenceFrames += 1
        updateInferenceSchedule(now)
      } else {
        submitInference(now)
      }
    }

    const frameDelta = clamp(delta || 1 / 60, 1 / 240, 0.05)
    const velocityBlend = 1 - Math.exp(-(frameDelta * 1000) / FACE_CENTER_VELOCITY_SMOOTHING_MS)
    const updateVelocity = (current: number, desired: number) => {
      const next = current + (desired - current) * velocityBlend
      return Math.abs(next) < FACE_CENTER_STOP_SPEED && desired === 0 ? 0 : next
    }
    const target = faceState.target
    const targetMaxAge = faceState.isMoving ? 4500 : 1100
    if (!target || now - target.lastSeenAt > targetMaxAge) {
      faceState.yawVelocity = updateVelocity(faceState.yawVelocity, 0)
      faceState.pitchVelocity = updateVelocity(faceState.pitchVelocity, 0)
      faceState.isMoving = faceState.yawVelocity !== 0 || faceState.pitchVelocity !== 0
      const yawLimit = getProjectionYawLimit(options.projection)
      const yawStep = faceState.yawVelocity * frameDelta
      options.viewRef.current.yaw
        = yawLimit === undefined
          ? options.viewRef.current.yaw + yawStep
          : clamp(shortestAngle(options.viewRef.current.yaw) + yawStep, -yawLimit, yawLimit)
      options.viewRef.current.pitch = clamp(
        options.viewRef.current.pitch + faceState.pitchVelocity * frameDelta,
        -85,
        85,
      )
      setOverlay({})
      return
    }

    const viewportFaceX = VIEWPORT_TARGET_X + target.x
    const viewportFaceY = VIEWPORT_TARGET_Y + target.y
    const yawError = target.yaw === undefined
      ? getViewportYawOffset(camera, viewportFaceX) - getViewportYawOffset(camera, VIEWPORT_TARGET_X)
      : shortestAngle(target.yaw - options.viewRef.current.yaw)
    const pitchError = target.pitch === undefined
      ? getViewportPitchOffset(camera, viewportFaceY) - getViewportPitchOffset(camera, VIEWPORT_TARGET_Y)
      : target.pitch - options.viewRef.current.pitch
    const yawDeadZone = target.yaw === undefined
      ? Math.abs(getViewportYawOffset(camera, VIEWPORT_TARGET_X + VIEWPORT_DEAD_ZONE_X) - getViewportYawOffset(camera, VIEWPORT_TARGET_X))
      : 6
    const pitchDeadZone = target.yaw === undefined
      ? Math.abs(getViewportPitchOffset(camera, VIEWPORT_TARGET_Y + VIEWPORT_DEAD_ZONE_Y) - getViewportPitchOffset(camera, VIEWPORT_TARGET_Y))
      : 7
    // Remove the dead zone from the error instead of switching the full error
    // on and off at its edge. This lets the camera ease to a stop smoothly.
    const x = Math.sign(yawError) * Math.max(0, Math.abs(yawError) - yawDeadZone)
    const y = Math.sign(pitchError) * Math.max(0, Math.abs(pitchError) - pitchDeadZone)
    const hint
      = Math.abs(yawError) >= 18
        ? {
            side: yawError > 0 ? ("right" as const) : ("left" as const),
            top: 50 + clamp(-pitchError, -42, 42) * 0.32,
            text: `${yawError > 0 ? "→" : "←"} ${Math.round(Math.abs(yawError))}°`,
          }
        : undefined

    setOverlay({ hint })
    if (!x && !y) faceState.offCenterSince = undefined
    else faceState.offCenterSince ??= now
    const panoramaTarget = target.mode === "panorama"
    const farTarget = Math.abs(yawError) > 70
    const response = FACE_CENTER_RESPONSE * (panoramaTarget ? 1.25 : farTarget ? 1.1 : 1)
    const maxSpeed = FACE_CENTER_MAX_SPEED * (panoramaTarget ? 1.35 : farTarget ? 1.15 : 1)
    const desiredYawVelocity = clamp(x * response, -maxSpeed, maxSpeed)
    const desiredPitchVelocity = clamp(y * response, -maxSpeed, maxSpeed)
    faceState.yawVelocity = updateVelocity(faceState.yawVelocity, desiredYawVelocity)
    faceState.pitchVelocity = updateVelocity(faceState.pitchVelocity, desiredPitchVelocity)
    const yawStep = faceState.yawVelocity * frameDelta
    const pitchStep = faceState.pitchVelocity * frameDelta
    const yawLimit = getProjectionYawLimit(options.projection)

    faceState.isMoving = faceState.yawVelocity !== 0 || faceState.pitchVelocity !== 0
    options.viewRef.current.yaw
      = yawLimit === undefined
        ? options.viewRef.current.yaw + yawStep
        : clamp(shortestAngle(options.viewRef.current.yaw) + yawStep, -yawLimit, yawLimit)
    options.viewRef.current.pitch = clamp(options.viewRef.current.pitch + pitchStep, -85, 85)
  }

  function render(now: number) {
    if (disposed) return
    frameId = 0
    const schedule = scheduleFrame(now, options.frameRate, nextPlaybackFrameAt)
    nextPlaybackFrameAt = schedule.nextFrameAt
    if (!schedule.render) {
      requestRender()
      return
    }
    const delta = (now - lastFrameAt) / 1000
    lastFrameAt = now
    if (camera.zoom !== options.viewRef.current.zoom) {
      camera.zoom = options.viewRef.current.zoom
      camera.updateProjectionMatrix()
    }
    camera.rotation.set(MathUtils.degToRad(options.viewRef.current.pitch), MathUtils.degToRad(options.viewRef.current.yaw), 0, "YXZ")
    const renderStartedAt = performance.now()
    const viewports = getRenderViewports(mount.clientWidth, mount.clientHeight, options.splitScreen)
    renderer.setScissorTest(viewports.length > 1)
    renderer.setViewport(0, 0, mount.clientWidth, mount.clientHeight)
    renderer.setScissor(0, 0, mount.clientWidth, mount.clientHeight)
    const renderViewport = (viewport: RenderViewport) => {
      renderer.setViewport(viewport.x, viewport.y, viewport.width, viewport.height)
      renderer.setScissor(viewport.x, viewport.y, viewport.width, viewport.height)
      renderer.render(scene, camera)
    }

    viewports.forEach(renderViewport)
    renderer.setScissorTest(false)
    frameCapture?.(renderer.domElement)
    lastRenderMs = performance.now() - renderStartedAt
    recentRenderTimes.push(lastRenderMs)
    if (recentRenderTimes.length > 180) recentRenderTimes.shift()
    if (options.debugPanelOpen) updatePerformanceMetrics(now, delta * 1000)
    // Sample immediately after rendering so WebGL does not need an expensive
    // preserveDrawingBuffer allocation just for face tracking.
    runFaceAutoCenter(now, delta)

    if (options.hidden || video.paused || !hasCurrentVideoFrame()) return
    if (dragging.active || faceState.isMoving) {
      requestRender()
      return
    }
    if (!("requestVideoFrameCallback" in video)) requestRender()
  }

  updateVisibility()
  requestRender()

  return {
    getOutputCanvas: () => renderer.domElement,
    setFrameCapture: capture => (frameCapture = capture),
    update(nextOptions) {
      if (nextOptions.frameRate !== undefined && nextOptions.frameRate !== options.frameRate) {
        nextPlaybackFrameAt = undefined
        faceState.nextDetectionAt = 0
      }
      const shouldRebuild = nextOptions.projection !== undefined
      const opensDebugPanel = nextOptions.debugPanelOpen === true && !options.debugPanelOpen
      const invalidatesInference
        = nextOptions.projection !== undefined
          || nextOptions.hidden !== undefined
          || nextOptions.faceAutoCenter !== undefined
      if (invalidatesInference) inferenceGeneration += 1
      Object.assign(options, nextOptions)
      if (opensDebugPanel) {
        fpsFrameCount = 0
        fpsSampleStartedAt = performance.now()
        recentFrameTimes.length = 0
        recentRenderTimes.length = 0
        lastRenderMs = 0
        recentInferenceCompletions = []
        lastInferenceMs = 0
        lastCaptureMs = 0
        lastInputSize = "--"
        skippedInferenceFrames = 0
        options.fpsElement.textContent = "FPS --  P95 -- ms"
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
          faceState.nextDetectionAt = 0
        }
        requestRender()
      }
    },
    resetMedia() {
      inferenceGeneration += 1
      stopScheduledRender()
      faceState.faces = []
      faceState.target = undefined
      faceState.recoveryMode = undefined
      faceState.consecutiveMisses = 0
      faceState.isMoving = false
      faceState.yawVelocity = 0
      faceState.pitchVelocity = 0
      faceState.nextDetectionAt = 0
      setOverlay({})
      recentFrameTimes.length = 0
      recentRenderTimes.length = 0
      recentInferenceCompletions = []
      recentInferenceTimes.length = 0
      sampleCanvas.width = 1
      sampleCanvas.height = 1
      texture.needsUpdate = true
      renderer.renderLists.dispose()
    },
    destroy() {
      disposed = true
      inferenceGeneration += 1
      stopScheduledRender()
      if (videoFrameCallbackId) video.cancelVideoFrameCallback(videoFrameCallbackId)
      video.removeEventListener("loadedmetadata", onMetadata)
      video.removeEventListener("playing", onVideoActivity)
      video.removeEventListener("pause", onVideoPause)
      video.removeEventListener("seeked", onVideoActivity)
      video.removeEventListener("loadeddata", onVideoActivity)
      resizeObserver.disconnect()
      renderer.domElement.removeEventListener("pointerdown", onPointerDown)
      renderer.domElement.removeEventListener("pointermove", onPointerMove)
      renderer.domElement.removeEventListener("pointerup", onPointerUp)
      renderer.domElement.removeEventListener("pointercancel", onPointerUp)
      renderer.domElement.removeEventListener("wheel", onWheel)
      touchPoints.clear()
      pinch = undefined
      scene.remove(projection)
      disposeObject(projection)
      texture.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    },
  }
}
