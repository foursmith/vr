import type { CameraView, ProjectionMode, ProjectionQuality } from "@foursmith/player-core"
import type { FaceCenteringMode, FaceInferenceMode, FaceInferenceResult, FacePose } from "../face-tracking/protocol"
import type { DetectionMode, FaceAutoCenterState, PanoramaSample } from "./face-auto-center"
import type { FaceInferenceActivity } from "./frame-scheduler"
import { createVrPlayerCore, DEFAULT_FOV, DEFAULT_ZOOM, PROJECTION_OPTIONS, QUALITY_OPTIONS } from "@foursmith/player-core"
import { MathUtils, Vector3 } from "three"
import {
  applyDetections,
  constrainFaceAutoCenterView,
  FACE_CENTER_MAX_FORWARD,
  FACE_CENTER_MIN_FORWARD,
  getFaceCenteringError,
  getFaceCenteringVelocity,
  getFaceDetectionRange,
  getFaceForwardVelocity,
  getFaceInferenceMode,
  getFaceMovementHint,
  getFacePitchAdjustedCenter,
  getProjectionYawLimit,
  mapSampleFaceToPanorama,
  pauseFaceAutoCenter,
  resumeFaceAutoCenter,
  setPanoramaTarget,
  setViewportTarget,
  shouldEnterPanoramaRecovery,
  updateFaceMotion,
} from "./face-auto-center"
import {
  createPerspectivePanoramaSample,
  drawSampleBoxes,
  drawViewportInferenceSample,
  getPanoramaScanTile,
  getPanoramaScanTileCount,
} from "./face-sampling"
import { faceInferencePeriod, scheduleFrame } from "./frame-scheduler"

export { DEFAULT_FOV, DEFAULT_ZOOM, PROJECTION_OPTIONS, QUALITY_OPTIONS }
export type { CameraView, ProjectionMode, ProjectionQuality }

export interface MutableRefObject<T> { current: T }

const MIN_ZOOM = 0.8
const MAX_ZOOM = 2.4
const WHEEL_ZOOM_SPEED = 0.0016
const TRACKPAD_PINCH_ZOOM_SPEED = 0.01
const PANORAMA_DIRECTION_ANCHOR_WEIGHT = 1.35
const FACE_TARGET_GRACE_MS = 900
const VIEWPORT_SAMPLE_WIDTH = 320
const PANORAMA_SAMPLE_WIDTH = 320
const MAX_SPLIT_SCREEN_PANELS = 3
const MIN_SPLIT_SCREEN_ASPECT = 9 / 16
const FACE_CENTER_VELOCITY_SMOOTHING_MS = 260
const FACE_CENTER_STOP_SPEED = 0.025
const SPHERE_SURFACE_DISTANCE = 100
const FLAT_SURFACE_DISTANCE = 65

interface RenderViewport { x: number, y: number, width: number, height: number }

interface OverlayState {
  hint?: { left: number, top: number, text: string }
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const shortestAngle = (degrees: number) => ((degrees + 540) % 360) - 180

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
  faceCenteringMode: FaceCenteringMode
  debugPanelOpen: boolean
  viewRef: MutableRefObject<CameraView>
  onZoomChange: (zoom: number) => void
  onFaceAutoCenterPauseChange: (paused: boolean) => void
}

export interface VrSceneController {
  update: (nextOptions: Partial<Pick<VrSceneOptions, "projection" | "quality" | "frameRate" | "hidden" | "splitScreen" | "faceAutoCenter" | "faceCenteringMode" | "debugPanelOpen">>) => void
  getOutputCanvas: () => HTMLCanvasElement
  setFrameCapture: (capture?: (canvas: HTMLCanvasElement) => void) => void
  pauseFaceAutoCenter: () => void
  resumeFaceAutoCenter: () => void
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
  let inferenceActivity: FaceInferenceActivity = "searching"
  let panoramaScanIndex = 0
  let panoramaScanOriginYaw = options.viewRef.current.yaw
  let panoramaScanOriginPitch = options.viewRef.current.pitch
  let lastInputSize = "--"
  let skippedInferenceFrames = 0
  let overlayVisible = !options.hintElement.hidden
  let lastOverlayText = options.hintElement.textContent ?? ""
  let lastOverlayLeft = Number.NaN
  let lastOverlayTop = Number.NaN
  const initialViewport = getRenderViewports(
    Math.max(1, mount.clientWidth),
    Math.max(1, mount.clientHeight),
    options.splitScreen,
  )[0]
  const core = createVrPlayerCore({
    video,
    projection: options.projection,
    quality: options.quality,
    width: mount.clientWidth,
    height: mount.clientHeight,
    aspect: initialViewport.width / initialViewport.height,
    devicePixelRatio: window.devicePixelRatio || 1,
  })
  const { camera, renderer, scene, texture } = core
  camera.zoom = options.viewRef.current.zoom
  camera.updateProjectionMatrix()
  renderer.domElement.className = "block h-dvh w-full touch-none saturate-105 contrast-102"
  const applyRenderQuality = () => {
    core.setQuality(options.quality, window.devicePixelRatio || 1)
    core.setSize(mount.clientWidth, mount.clientHeight, camera.aspect)
    renderer.domElement.style.imageRendering = "auto"
    renderer.domElement.dataset.quality = options.quality
    renderer.domElement.dataset.pixelRatio = renderer.getPixelRatio().toFixed(2)
  }
  applyRenderQuality()
  mount.appendChild(renderer.domElement)

  const faceState: FaceAutoCenterState = {
    faces: [],
    detectionMode: "viewport",
    nextDetectionAt: 0,
    lastDetectionAt: 0,
    consecutiveMisses: 0,
    consecutiveViewportMisses: 0,
    isMoving: false,
    yawVelocity: 0,
    pitchVelocity: 0,
    forwardVelocity: 0,
    lastErrorAt: 0,
  }
  const sampleContext = sampleCanvas.getContext("2d", { alpha: false, willReadFrequently: true })
  const cameraForward = new Vector3()
  const getFaceSurfaceDistance = (projection: ProjectionMode) =>
    projection === "flat_2d" ? FLAT_SURFACE_DISTANCE : SPHERE_SURFACE_DISTANCE
  const applyCameraPose = () => {
    camera.rotation.set(MathUtils.degToRad(options.viewRef.current.pitch), MathUtils.degToRad(options.viewRef.current.yaw), 0, "YXZ")
    cameraForward
      .set(0, 0, -1)
      .applyEuler(camera.rotation)
      .multiplyScalar(options.viewRef.current.forward)
    camera.position.copy(cameraForward)
  }
  interface DetectedFace {
    boundingBox: { x: number, y: number, width: number, height: number }
    score?: number
    pose?: FacePose
    center?: { x: number, y: number }
  }
  interface FaceDetectorBackend {
    detect: (
      source: ImageBitmapSource,
      detectionRange?: ReturnType<typeof getFaceDetectionRange>,
      inferenceMode?: FaceInferenceMode,
    ) => Promise<DetectedFace[]>
    destroy: () => void
  }
  let faceDetector: FaceDetectorBackend | undefined
  let faceDetectorPromise: Promise<FaceDetectorBackend> | undefined
  let faceDetectorGeneration = 0
  let inferenceInFlight = false
  let inferenceGeneration = 0

  const ensureFaceDetector = () => {
    if (faceDetector) return Promise.resolve(faceDetector)
    if (faceDetectorPromise) return faceDetectorPromise
    const generation = faceDetectorGeneration
    const loading: Promise<FaceDetectorBackend> = options.faceCenteringMode === "system"
      ? import("../../system-face-detector-client").then(module => module.createSystemFaceDetectorWorkerClient())
      : import("../../mediapipe-face-detector-client").then(module => module.createMediaPipeFaceDetectorClient())
    faceDetectorPromise = loading.then((detector) => {
      if (disposed || generation !== faceDetectorGeneration) {
        detector.destroy()
        throw new Error("Face detector initialization was superseded")
      }
      faceDetector = detector
      return detector
    }).catch((error) => {
      if (generation === faceDetectorGeneration) faceDetectorPromise = undefined
      throw error
    })
    return faceDetectorPromise
  }

  const releaseFaceDetector = () => {
    faceDetectorGeneration += 1
    faceDetector?.destroy()
    faceDetector = undefined
    faceDetectorPromise = undefined
    sampleCanvas.width = 1
    sampleCanvas.height = 1
  }

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
      if (!Number.isFinite(lastOverlayLeft) || Math.abs(lastOverlayLeft - hint.left) >= 0.1) {
        options.hintElement.style.left = `${hint.left}%`
        lastOverlayLeft = hint.left
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
      `Track ${trackingHz.toFixed(1)} Hz  Infer ${lastInferenceMs.toFixed(1)} ms  ${inferenceActivity}`,
      `Motion ${(faceState.motion?.speed ?? 0).toFixed(2)}/s  Away ${Math.max(0, faceState.motion?.recedingSpeed ?? 0).toFixed(2)}/s  Size ${(faceState.motion?.size ?? 0).toFixed(2)}`,
      `Capture ${lastCaptureMs.toFixed(1)} ms  Skipped ${skippedInferenceFrames}`,
      `${faceDetector ? options.faceCenteringMode === "system" ? "System Worker" : "MediaPipe Worker" : "Face detector idle"}  Input ${lastInputSize}`,
    ].join("\n")
    fpsFrameCount = 0
    fpsSampleStartedAt = now
  }

  const resize = () => {
    const width = Math.max(1, mount.clientWidth)
    const height = Math.max(1, mount.clientHeight)
    const primaryViewport = getRenderViewports(width, height, options.splitScreen)[0]
    core.setSize(width, height, primaryViewport.width / primaryViewport.height)
    requestRender()
  }

  const rebuildProjection = () => {
    core.setProjection(options.projection)
  }

  const onMetadata = () => {
    texture.needsUpdate = true
    rebuildProjection()
    faceState.motion = undefined
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
    faceState.motion = undefined
    faceState.recoveryMode = undefined
    faceState.consecutiveMisses = 0
    faceState.consecutiveViewportMisses = 0
    faceState.yawVelocity = 0
    faceState.pitchVelocity = 0
    faceState.forwardVelocity = 0
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

  const setManualFaceCenterPaused = (paused: boolean) => {
    if (paused === Boolean(faceState.manuallyPaused)) return
    inferenceGeneration += 1
    if (paused) pauseFaceAutoCenter(faceState)
    else resumeFaceAutoCenter(faceState)
    options.onFaceAutoCenterPauseChange(paused)
    setOverlay({})
    requestRender()
  }

  const pauseFaceCenterForManualInput = () => {
    if (options.faceAutoCenter) setManualFaceCenterPaused(true)
  }

  const dragging = { active: false, pointerId: 0, x: 0, y: 0 }
  const touchPoints = new Map<number, { x: number, y: number }>()
  let pinch: { pointerIds: [number, number], distance: number, zoom: number } | undefined

  const applyZoom = (nextZoom: number) => {
    const clampedZoom = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM)
    if (clampedZoom === options.viewRef.current.zoom) return
    options.viewRef.current.zoom = clampedZoom
    options.onZoomChange(clampedZoom)
    pauseFaceCenterForManualInput()
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
      requestRender()
      return
    }
    dragging.active = true
    dragging.pointerId = event.pointerId
    dragging.x = event.clientX
    dragging.y = event.clientY
    renderer.domElement.setPointerCapture?.(event.pointerId)
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
    if (dx || dy) pauseFaceCenterForManualInput()
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

  const updateInferenceSchedule = (
    now: number,
    completedInferenceMs = 0,
    scheduleOverride?: { activity: FaceInferenceActivity, period: number },
  ) => {
    const sortedInferenceTimes = [...recentInferenceTimes].sort((a, b) => a - b)
    const p95Index = Math.max(0, Math.ceil(sortedInferenceTimes.length * 0.95) - 1)
    const inferenceP95 = sortedInferenceTimes[p95Index] ?? 0
    const target = faceState.target
    const targetNeedsMovement = target
      ? getFaceCenteringError(target, camera, options.viewRef.current, faceState.isMoving).needsMovement
      : false
    if (scheduleOverride) inferenceActivity = scheduleOverride.activity
    else if (faceState.recoveryMode === "panorama") inferenceActivity = "recovery"
    else if (!target || faceState.consecutiveMisses > 0) inferenceActivity = "searching"
    else if (faceState.isMoving || faceState.offCenterSince !== undefined || targetNeedsMovement) inferenceActivity = "active"
    else inferenceActivity = "stable"
    const motion = faceState.motion && now - faceState.motion.lastSeenAt < 1500 ? faceState.motion : undefined
    const adaptivePeriod = scheduleOverride?.period
      ?? faceInferencePeriod(options.frameRate, inferenceP95, inferenceActivity, motion)
    // Keep the adaptive period measured from inference start to inference start.
    faceState.nextDetectionAt = now + Math.max(0, adaptivePeriod - completedInferenceMs)
    return adaptivePeriod
  }

  const updateTrackingResult = (foundFace: boolean, time: number, detectionMode: DetectionMode) => {
    if (foundFace) {
      faceState.consecutiveMisses = 0
      faceState.consecutiveViewportMisses = 0
      return
    }

    faceState.consecutiveMisses += 1
    if (detectionMode === "viewport") faceState.consecutiveViewportMisses += 1
    if (faceState.target && time - faceState.target.lastSeenAt > FACE_TARGET_GRACE_MS) {
      faceState.target = undefined
    }
    if (faceState.consecutiveMisses >= 3 && !faceState.target) {
      faceState.selectedFace = undefined
    }
  }

  const updateViewportRecoveryMode = (foundFace: boolean) => {
    panoramaScanIndex = 0
    if (foundFace) {
      faceState.recoveryMode = undefined
      return
    }

    if (!shouldEnterPanoramaRecovery(faceState.consecutiveViewportMisses + 1)) {
      faceState.recoveryMode = undefined
      return
    }

    panoramaScanOriginYaw = options.viewRef.current.yaw
    panoramaScanOriginPitch = options.viewRef.current.pitch
    faceState.recoveryMode = "panorama"
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
      const face = applyDetections(faceState, result.faces, time, "viewport")
      faceState.detectionMode = "viewport"
      if (face) updateFaceMotion(faceState, face, time)
      const pitchAdjustedCenter = result.center
        ? getFacePitchAdjustedCenter(result.center, face?.pose?.pitch)
        : undefined
      foundFace = setViewportTarget(
        faceState,
        face,
        time,
        pitchAdjustedCenter,
        options.viewRef.current.forward,
        getFaceSurfaceDistance(projection),
      )
      updateViewportRecoveryMode(foundFace)
    } else if (detectionMode === "panorama" && panoramaSample) {
      faceState.detectionMode = "panorama"
      const face = applyDetections(faceState, result.faces, time, "panorama", {
        x: panoramaSample.center.x,
        y: panoramaSample.center.y,
        weight: PANORAMA_DIRECTION_ANCHOR_WEIGHT,
        wrapX: panoramaSample.wraps,
      }, sampleFace => mapSampleFaceToPanorama(sampleFace, panoramaSample))
      foundFace = setPanoramaTarget(faceState, face, time, projection, camera)
      if (foundFace) {
        panoramaScanIndex = 0
        faceState.recoveryMode = undefined
      } else if (panoramaScanIndex + 1 < getPanoramaScanTileCount(projection)) {
        panoramaScanIndex += 1
        faceState.recoveryMode = "panorama"
      } else {
        panoramaScanIndex = 0
        faceState.recoveryMode = undefined
        faceState.consecutiveViewportMisses = 0
      }
    } else {
      faceState.detectionMode = "viewport"
      const face = applyDetections(faceState, result.faces, time, "viewport")
      if (face) updateFaceMotion(faceState, face, time)
      foundFace = setViewportTarget(
        faceState,
        face,
        time,
        undefined,
        options.viewRef.current.forward,
        getFaceSurfaceDistance(projection),
      )
      updateViewportRecoveryMode(foundFace)
    }

    updateTrackingResult(foundFace, time, detectionMode)
    if (options.debugPanelOpen) {
      drawSampleBoxes(faceState, sampleCanvas, sampleContext!, performance.now(), faceState.detectionMode)
    }
    return !foundFace && detectionMode === "viewport" && faceState.consecutiveViewportMisses === 1
  }

  const renderSceneViewports = () => {
    const viewports = getRenderViewports(mount.clientWidth, mount.clientHeight, options.splitScreen)
    renderer.setScissorTest(viewports.length > 1)
    renderer.setViewport(0, 0, mount.clientWidth, mount.clientHeight)
    renderer.setScissor(0, 0, mount.clientWidth, mount.clientHeight)
    viewports.forEach((viewport) => {
      renderer.setViewport(viewport.x, viewport.y, viewport.width, viewport.height)
      renderer.setScissor(viewport.x, viewport.y, viewport.width, viewport.height)
      renderer.render(scene, camera)
    })
    renderer.setScissorTest(false)
  }

  const capturePanoramaInferenceSample = (projection: ProjectionMode) => {
    const tile = getPanoramaScanTile(projection, panoramaScanIndex, panoramaScanOriginYaw, panoramaScanOriginPitch)
    const savedCamera = {
      aspect: camera.aspect,
      fov: camera.fov,
      zoom: camera.zoom,
      x: camera.rotation.x,
      y: camera.rotation.y,
      z: camera.rotation.z,
      order: camera.rotation.order,
      positionX: camera.position.x,
      positionY: camera.position.y,
      positionZ: camera.position.z,
    }
    const side = Math.max(1, Math.min(mount.clientWidth, mount.clientHeight))
    const sidePixels = Math.min(
      renderer.domElement.width,
      renderer.domElement.height,
      Math.max(1, Math.round(side * renderer.getPixelRatio())),
    )

    let size: ReturnType<typeof drawViewportInferenceSample>
    try {
      camera.aspect = 1
      camera.fov = tile.fov
      camera.zoom = 1
      camera.position.set(0, 0, 0)
      camera.rotation.set(MathUtils.degToRad(tile.pitch), MathUtils.degToRad(tile.yaw), 0, "YXZ")
      camera.updateProjectionMatrix()
      renderer.setScissorTest(true)
      renderer.setViewport(0, 0, side, side)
      renderer.setScissor(0, 0, side, side)
      renderer.render(scene, camera)

      size = drawViewportInferenceSample(
        sampleCanvas,
        sampleContext!,
        renderer.domElement,
        0,
        renderer.domElement.height - sidePixels,
        sidePixels,
        sidePixels,
        PANORAMA_SAMPLE_WIDTH,
      )
    } finally {
      camera.aspect = savedCamera.aspect
      camera.fov = savedCamera.fov
      camera.zoom = savedCamera.zoom
      camera.position.set(savedCamera.positionX, savedCamera.positionY, savedCamera.positionZ)
      camera.rotation.set(savedCamera.x, savedCamera.y, savedCamera.z, savedCamera.order)
      camera.updateProjectionMatrix()
      renderSceneViewports()
    }

    return size ? createPerspectivePanoramaSample(projection, tile) : undefined
  }

  const submitInference = (now: number) => {
    if (!sampleContext || inferenceInFlight) return

    const captureStartedAt = performance.now()
    let detectionMode: DetectionMode = "viewport"
    let panoramaSample: PanoramaSample | undefined
    let inputWidth = 0
    let inputHeight = 0
    let completedInferenceMs = 0
    let completedScheduleOverride: { activity: FaceInferenceActivity, period: number } | undefined
    const projection = options.projection

    try {
      if (faceState.recoveryMode === "panorama") {
        detectionMode = "panorama"
        panoramaSample = capturePanoramaInferenceSample(projection)
        if (!panoramaSample) return
        inputWidth = sampleCanvas.width
        inputHeight = sampleCanvas.height
      } else {
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
    const inferencePeriodAtStart = updateInferenceSchedule(now)
    const inferenceActivityAtStart = inferenceActivity
    void ensureFaceDetector()
      .then((detector) => {
        lastCaptureMs = performance.now() - captureStartedAt
        const inferenceMode = getFaceInferenceMode(
          options.faceCenteringMode,
          detectionMode,
          Boolean(faceState.target?.mode === "viewport" && faceState.consecutiveMisses === 0),
        )
        return detector.detect(sampleCanvas, getFaceDetectionRange(detectionMode), inferenceMode)
          .then(faces => ({ faces, inferenceMode }))
      })
      .then(({ faces, inferenceMode }) => {
        completedInferenceMs = performance.now() - captureStartedAt
        if (disposed || generation !== inferenceGeneration || video.paused || !options.faceAutoCenter || options.hidden) return
        const result: FaceInferenceResult = {
          id: 0,
          type: "result",
          mode: inferenceMode,
          timestamp: now,
          faces: faces.map(face => ({
            x: face.boundingBox.x / inputWidth,
            y: face.boundingBox.y / inputHeight,
            width: face.boundingBox.width / inputWidth,
            height: face.boundingBox.height / inputHeight,
            score: face.score ?? 1,
            pose: face.pose,
          })),
          center: faces[0]?.center
            ? { x: faces[0].center.x / inputWidth, y: faces[0].center.y / inputHeight }
            : undefined,
          inferenceMs: completedInferenceMs,
        }
        if (applyInferenceResult(result, detectionMode, panoramaSample, projection)) {
          completedScheduleOverride = { activity: inferenceActivityAtStart, period: inferencePeriodAtStart }
        }
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
          updateInferenceSchedule(performance.now(), completedInferenceMs, completedScheduleOverride)
          requestRender()
        }
      })
  }

  const runFaceAutoCenter = (now: number, delta: number) => {
    if (!sampleContext) return

    if (video.paused) {
      faceState.yawVelocity = 0
      faceState.pitchVelocity = 0
      faceState.forwardVelocity = 0
      faceState.isMoving = false
      setOverlay({})
      return
    }

    if (!options.faceAutoCenter || options.hidden) {
      faceState.faces = []
      faceState.target = undefined
      faceState.motion = undefined
      faceState.recoveryMode = undefined
      faceState.consecutiveMisses = 0
      faceState.consecutiveViewportMisses = 0
      faceState.yawVelocity = 0
      faceState.pitchVelocity = 0
      faceState.forwardVelocity = 0
      faceState.isMoving = false
      setOverlay({})
      return
    }

    if (!video.videoWidth || !video.videoHeight || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      faceState.faces = []
      faceState.target = undefined
      faceState.motion = undefined
      faceState.recoveryMode = undefined
      faceState.consecutiveMisses = 0
      faceState.consecutiveViewportMisses = 0
      faceState.yawVelocity = 0
      faceState.pitchVelocity = 0
      faceState.forwardVelocity = 0
      faceState.isMoving = false
      setOverlay({})
      return
    }

    if (faceState.manuallyPaused || now < options.viewRef.current.pausedUntil) return

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
    const applySafeMovement = () => {
      const current = options.viewRef.current
      const moveAxis = (axis: "yaw" | "pitch" | "forward", proposedValue: number) => {
        const proposed = { yaw: current.yaw, pitch: current.pitch, forward: current.forward, [axis]: proposedValue }
        const constrained = constrainFaceAutoCenterView(options.projection, camera, current, proposed)
        current[axis] = constrained[axis]
        if (Math.abs(constrained[axis] - proposedValue) > 0.0001) {
          if (axis === "yaw") faceState.yawVelocity = 0
          else if (axis === "pitch") faceState.pitchVelocity = 0
          else faceState.forwardVelocity = 0
        }
      }
      const yawLimit = getProjectionYawLimit(options.projection)
      const nextYaw = yawLimit === undefined
        ? current.yaw + faceState.yawVelocity * frameDelta
        : clamp(shortestAngle(current.yaw) + faceState.yawVelocity * frameDelta, -yawLimit, yawLimit)
      moveAxis("yaw", nextYaw)
      moveAxis("pitch", clamp(current.pitch + faceState.pitchVelocity * frameDelta, -85, 85))
      moveAxis("forward", clamp(
        current.forward + faceState.forwardVelocity * frameDelta,
        FACE_CENTER_MIN_FORWARD,
        FACE_CENTER_MAX_FORWARD,
      ))
      faceState.isMoving = faceState.yawVelocity !== 0 || faceState.pitchVelocity !== 0 || faceState.forwardVelocity !== 0
    }
    const target = faceState.target
    const targetMaxAge = faceState.isMoving ? 4500 : 1100
    if (!target || now - target.lastSeenAt > targetMaxAge) {
      faceState.yawVelocity = updateVelocity(faceState.yawVelocity, 0)
      faceState.pitchVelocity = updateVelocity(faceState.pitchVelocity, 0)
      faceState.forwardVelocity = updateVelocity(faceState.forwardVelocity, 0)
      applySafeMovement()
      setOverlay({})
      return
    }

    const error = getFaceCenteringError(target, camera, options.viewRef.current, faceState.isMoving)
    const x = error.yawOffset
    const y = error.pitchOffset
    const forward = error.forwardOffset
    const hint = getFaceMovementHint(error)

    setOverlay({ hint })
    if (!x && !y && !forward) faceState.offCenterSince = undefined
    else faceState.offCenterSince ??= now
    const desiredYawVelocity = getFaceCenteringVelocity(x, target.mode)
    const desiredPitchVelocity = getFaceCenteringVelocity(y, target.mode)
    const desiredForwardVelocity = getFaceForwardVelocity(forward)
    faceState.yawVelocity = x ? updateVelocity(faceState.yawVelocity, desiredYawVelocity) : 0
    faceState.pitchVelocity = y ? updateVelocity(faceState.pitchVelocity, desiredPitchVelocity) : 0
    faceState.forwardVelocity = forward ? updateVelocity(faceState.forwardVelocity, desiredForwardVelocity) : 0
    applySafeMovement()
  }

  function render(now: number) {
    if (disposed) return
    frameId = 0
    const scheduleMode = dragging.active || faceState.isMoving ? "interaction" : "playback"
    const schedule = scheduleFrame(now, options.frameRate, nextPlaybackFrameAt, scheduleMode)
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
    applyCameraPose()
    const renderStartedAt = performance.now()
    renderSceneViewports()
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
    pauseFaceAutoCenter: pauseFaceCenterForManualInput,
    resumeFaceAutoCenter: () => setManualFaceCenterPaused(false),
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
          || nextOptions.faceCenteringMode !== undefined
      if (invalidatesInference) inferenceGeneration += 1
      const releasesFaceDetector
        = nextOptions.faceAutoCenter === false
          || (nextOptions.faceCenteringMode !== undefined && nextOptions.faceCenteringMode !== options.faceCenteringMode)
      if (releasesFaceDetector) releaseFaceDetector()
      Object.assign(options, nextOptions)
      if (!options.faceAutoCenter && faceState.manuallyPaused) setManualFaceCenterPaused(false)
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
      if (faceState.manuallyPaused) {
        resumeFaceAutoCenter(faceState)
        options.onFaceAutoCenterPauseChange(false)
      }
      stopScheduledRender()
      faceState.faces = []
      faceState.target = undefined
      faceState.motion = undefined
      faceState.recoveryMode = undefined
      faceState.consecutiveMisses = 0
      faceState.consecutiveViewportMisses = 0
      faceState.isMoving = false
      faceState.yawVelocity = 0
      faceState.pitchVelocity = 0
      faceState.forwardVelocity = 0
      faceState.nextDetectionAt = 0
      setOverlay({})
      recentFrameTimes.length = 0
      recentRenderTimes.length = 0
      recentInferenceCompletions = []
      recentInferenceTimes.length = 0
      sampleCanvas.width = 1
      sampleCanvas.height = 1
      texture.needsUpdate = true
      core.resetMedia()
    },
    destroy() {
      disposed = true
      inferenceGeneration += 1
      releaseFaceDetector()
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
      core.destroy()
      renderer.domElement.remove()
    },
  }
}
