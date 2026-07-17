import type { PerspectiveCamera } from "three"
import type { CameraView, ProjectionMode } from "../config"
import type { FaceDetectorService } from "../detection/face-detector-service"
import type { FaceInferenceResult } from "../detection/protocol"
import type { FaceDetectionState } from "./face-detection-state"
import type { PanoramaScanTile } from "./face-sampling"
import type { DetectionMode, FaceAutoCenterState, FaceBox, PanoramaSample } from "./face-target-tracking"
import type { FaceInferenceActivity } from "./inference-schedule-policy"
import {
  estimateFaceCenteringDuration,
  getFaceCenteringPlan,
} from "./face-center-movement"
import {
  acceptFaceDetection,
  applyPanoramaDetectionMiss,
  applyViewportDetection,
  createFaceDetectionState,
  getActivePanoramaRecoveryTile,
  getActivePanoramaScan,
  getFaceDetectionMode,
  getFaceDetectionRange,
  getFaceDetectionRetryAt,
  prepareFaceDetection,
} from "./face-detection-state"
import {
  createPerspectivePanoramaSample,
  drawSampleBoxes,
  drawSampleStatus,
  getPanoramaRefinementTile,
  getPanoramaScanTiles,
  isPanoramaCandidateReliable,
} from "./face-sampling"
import {
  applyDetections,
  getPredictedFaceDirection,
  mapSampleFaceToPanorama,
  setPanoramaTarget,
  setViewportTarget,
  updateFaceMotion,
} from "./face-target-tracking"
import {
  FACE_CENTER_SHORT_MOVE_ETA_MS,
  faceInferencePeriod,
  movingFaceInferencePeriod,
  shouldRunFaceInference,
} from "./inference-schedule-policy"

const PANORAMA_DIRECTION_ANCHOR_WEIGHT = 1.35
const FACE_TARGET_GRACE_MS = 900
const VIEWPORT_SAMPLE_WIDTH = 320
const PANORAMA_SAMPLE_WIDTH = 320

export interface FaceScanCaptureSize {
  width: number
  height: number
}

interface ViewportCaptureContext {
  camera: PerspectiveCamera
  view: Pick<CameraView, "yaw" | "pitch" | "forward">
}

export interface FaceScanCapturePort {
  captureViewport: (
    canvas: HTMLCanvasElement,
    context: CanvasRenderingContext2D,
    targetWidth: number,
  ) => FaceScanCaptureSize | undefined
  capturePanoramaTile: (
    canvas: HTMLCanvasElement,
    context: CanvasRenderingContext2D,
    tile: PanoramaScanTile,
    targetWidth: number,
  ) => FaceScanCaptureSize | undefined
}

export type FaceScanDiagnosticEvent
  = | { type: "capture", durationMs: number, inputSize: string }
    | { type: "inference", completedAt: number, durationMs: number }
    | { type: "skip" }

export interface FaceScanControllerOptions {
  video: HTMLVideoElement
  camera: PerspectiveCamera
  faceState: FaceAutoCenterState
  detector: FaceDetectorService
  sampleCanvas: HTMLCanvasElement
  capture: FaceScanCapturePort
  getProjection: () => ProjectionMode
  getFrameRate: () => number
  getView: () => Pick<CameraView, "yaw" | "pitch" | "forward">
  getSurfaceDistance: (projection: ProjectionMode) => number
  isDebugEnabled: () => boolean
  canAcceptResult: () => boolean
  onDiagnosticEvent?: (event: FaceScanDiagnosticEvent) => void
  requestRender: () => void
}

export interface FaceScanSnapshot {
  detectionState: FaceDetectionState
  activity: FaceInferenceActivity
  lastInferenceMs: number
  rescanDuringMovement: boolean
  inFlight: boolean
  detectorReady: boolean
}

export interface FaceScanController {
  runDueInference: (now: number) => boolean
  invalidateInference: () => void
  resetDetection: () => void
  resetMedia: () => void
  releaseDetector: () => void
  setMovementRescan: (enabled: boolean) => void
  scheduleMovementRescan: (now: number, remainingDurationMs: number) => boolean
  snapshot: () => FaceScanSnapshot
  destroy: () => void
}

export const createFaceScanController = (options: FaceScanControllerOptions): FaceScanController => {
  const {
    camera,
    capture,
    detector,
    faceState,
    sampleCanvas,
    video,
  } = options
  const inferenceCanvas = sampleCanvas.ownerDocument.createElement("canvas")
  const inferenceContext = inferenceCanvas.getContext("2d", { alpha: false, willReadFrequently: true })
  const sampleContext = sampleCanvas.getContext("2d", { alpha: false, willReadFrequently: true })
  const recentInferenceTimes: number[] = []
  let detectionState = createFaceDetectionState()
  let inferenceInFlight = false
  let inferenceGeneration = 0
  let lastInferenceMs = 0
  let inferenceActivity: FaceInferenceActivity = "searching"
  let rescanDuringMovement = false
  let disposed = false

  const emitDiagnostic = (event: FaceScanDiagnosticEvent) => options.onDiagnosticEvent?.(event)

  const resetCanvas = (canvas: HTMLCanvasElement) => {
    canvas.width = 1
    canvas.height = 1
  }

  const updateInferenceSchedule = (
    now: number,
    completedInferenceMs = 0,
    scheduleOverride?: { activity: FaceInferenceActivity, period: number },
  ) => {
    const sortedInferenceTimes = [...recentInferenceTimes].sort((a, b) => a - b)
    const p95Index = Math.max(0, Math.ceil(sortedInferenceTimes.length * 0.95) - 1)
    const inferenceP95 = sortedInferenceTimes[p95Index] ?? 0
    const target = faceState.target
    const targetPlan = target
      ? getFaceCenteringPlan(target, camera, options.getView(), options.getProjection(), faceState.isMoving)
      : undefined
    const targetError = targetPlan?.error
    const targetNeedsMovement = targetError?.needsMovement ?? false
    const movementBlocked = Boolean(targetPlan?.blockedAxis && !targetNeedsMovement)
    const effectiveScheduleOverride = movementBlocked ? undefined : scheduleOverride
    if (effectiveScheduleOverride) inferenceActivity = effectiveScheduleOverride.activity
    else if (detectionState.phase === "panorama-scan") inferenceActivity = "recovery"
    else if (detectionState.phase !== "tracking" || !target) inferenceActivity = "searching"
    else if (faceState.isMoving || (!movementBlocked && (faceState.offCenterSince !== undefined || targetNeedsMovement))) inferenceActivity = "active"
    else inferenceActivity = "stable"
    const motion = faceState.motion && now - faceState.motion.lastSeenAt < 1500 ? faceState.motion : undefined
    const adaptivePeriod = effectiveScheduleOverride?.period
      ?? (faceState.isMoving && rescanDuringMovement && target && targetError
        ? movingFaceInferencePeriod(estimateFaceCenteringDuration(targetError, {
            yaw: faceState.yawVelocity,
            pitch: faceState.pitchVelocity,
            forward: faceState.forwardVelocity,
          }, target.mode), inferenceP95)
        : faceInferencePeriod(options.getFrameRate(), inferenceP95, inferenceActivity, motion))
    // Keep the adaptive period measured from inference start to inference start.
    faceState.nextDetectionAt = Math.max(
      now + Math.max(0, adaptivePeriod - completedInferenceMs),
      getFaceDetectionRetryAt(detectionState),
    )
    return adaptivePeriod
  }

  const clearStaleTrackingAfterMiss = (time: number) => {
    if (faceState.target && time - faceState.target.lastSeenAt > FACE_TARGET_GRACE_MS) {
      faceState.target = undefined
    }
    if (detectionState.misses >= 3 && !faceState.target) {
      faceState.selectedFace = undefined
    }
  }

  const applyInferenceResult = (
    result: FaceInferenceResult,
    detectionMode: DetectionMode,
    panoramaSample: PanoramaSample | undefined,
    projection: ProjectionMode,
    viewportCapture: ViewportCaptureContext | undefined,
  ) => {
    const time = result.timestamp
    const completedAt = performance.now()
    lastInferenceMs = result.inferenceMs
    recentInferenceTimes.push(result.inferenceMs)
    if (recentInferenceTimes.length > 20) recentInferenceTimes.shift()
    emitDiagnostic({ type: "inference", completedAt, durationMs: result.inferenceMs })
    let foundFace = false
    let preserveSchedule = false

    if (detectionMode === "panorama" && panoramaSample) {
      faceState.detectionMode = "panorama"
      const sampleFaces = new Map<FaceBox, FaceBox>()
      const face = applyDetections(faceState, result.faces, time, "panorama", {
        x: panoramaSample.center.x,
        y: panoramaSample.center.y,
        weight: PANORAMA_DIRECTION_ANCHOR_WEIGHT,
        wrapX: panoramaSample.wraps,
      }, (sampleFace) => {
        const mappedFace = mapSampleFaceToPanorama(sampleFace, panoramaSample)
        sampleFaces.set(mappedFace, sampleFace)
        return mappedFace
      })
      const sampleFace = face ? sampleFaces.get(face) : undefined
      if (face && isPanoramaCandidateReliable(sampleFace)) {
        foundFace = setPanoramaTarget(faceState, face, time, projection, camera)
        if (foundFace) detectionState = acceptFaceDetection()
      } else {
        detectionState = applyPanoramaDetectionMiss(
          detectionState,
          completedAt,
          face ? getPanoramaRefinementTile(projection, face) : undefined,
        )
      }
    } else {
      if (!viewportCapture) return false
      faceState.detectionMode = "viewport"
      const face = applyDetections(faceState, result.faces, time, "viewport")
      if (face) updateFaceMotion(faceState, face, time, viewportCapture.camera, viewportCapture.view)
      foundFace = setViewportTarget(
        faceState,
        face,
        time,
        viewportCapture.camera,
        viewportCapture.view,
        undefined,
        options.getSurfaceDistance(projection),
      )
      const transition = applyViewportDetection(detectionState, foundFace, () => getPanoramaScanTiles(
        projection,
        viewportCapture.view.yaw,
        viewportCapture.view.pitch,
        getPredictedFaceDirection(faceState, time, projection),
      ))
      detectionState = transition.state
      preserveSchedule = transition.preserveSchedule
    }

    if (!foundFace) clearStaleTrackingAfterMiss(time)
    if (options.isDebugEnabled() && sampleContext) {
      if (foundFace) {
        sampleCanvas.width = inferenceCanvas.width
        sampleCanvas.height = inferenceCanvas.height
        sampleContext.drawImage(inferenceCanvas, 0, 0)
        drawSampleBoxes(faceState, sampleCanvas, sampleContext, performance.now(), faceState.detectionMode)
      } else if (detectionMode === "viewport") {
        sampleCanvas.width = inferenceCanvas.width
        sampleCanvas.height = inferenceCanvas.height
        sampleContext.drawImage(inferenceCanvas, 0, 0)
        drawSampleStatus(sampleCanvas, sampleContext, "No face detected")
      }
    }
    return preserveSchedule
  }

  const capturePanoramaInferenceSample = (projection: ProjectionMode) => {
    if (!inferenceContext) return undefined
    const scan = getActivePanoramaScan(detectionState)
    const tile = scan && getActivePanoramaRecoveryTile(scan)
    if (!tile) return undefined
    const size = capture.capturePanoramaTile(
      inferenceCanvas,
      inferenceContext,
      tile,
      PANORAMA_SAMPLE_WIDTH,
    )
    return size ? createPerspectivePanoramaSample(projection, tile) : undefined
  }

  const submitInference = (now: number) => {
    if (!inferenceContext || inferenceInFlight) return false

    const captureStartedAt = performance.now()
    detectionState = prepareFaceDetection(detectionState, now)
    const detectionMode: DetectionMode = getFaceDetectionMode(detectionState)
    const detectionRange = getFaceDetectionRange(detectionState)
    let panoramaSample: PanoramaSample | undefined
    let inputWidth = 0
    let inputHeight = 0
    let completedInferenceMs = 0
    let completedScheduleOverride: { activity: FaceInferenceActivity, period: number } | undefined
    const projection = options.getProjection()
    const viewportCapture = detectionMode === "viewport"
      ? { camera: camera.clone(), view: { ...options.getView() } }
      : undefined

    try {
      if (detectionMode === "panorama") {
        panoramaSample = capturePanoramaInferenceSample(projection)
        if (!panoramaSample) return false
        inputWidth = inferenceCanvas.width
        inputHeight = inferenceCanvas.height
      } else {
        // Copy synchronously into the small reusable canvas. Creating an
        // ImageBitmap directly from the WebGL canvas can retain its full-size
        // backing buffer until the asynchronous capture has completed.
        const size = capture.captureViewport(
          inferenceCanvas,
          inferenceContext,
          VIEWPORT_SAMPLE_WIDTH,
        )
        if (!size) return false
        inputWidth = size.width
        inputHeight = size.height
      }
    } catch (error) {
      if (now - faceState.lastErrorAt > 3000) {
        faceState.lastErrorAt = now
        console.warn("face auto center could not capture inference frame", error)
      }
      updateInferenceSchedule(now)
      return false
    }

    const generation = inferenceGeneration
    const inputSize = `${inputWidth}×${inputHeight}`
    inferenceInFlight = true
    const inferencePeriodAtStart = updateInferenceSchedule(now)
    const inferenceActivityAtStart = inferenceActivity
    void detector.ensure()
      .then((backend) => {
        emitDiagnostic({
          type: "capture",
          durationMs: performance.now() - captureStartedAt,
          inputSize,
        })
        return backend.detect(inferenceCanvas, detectionRange)
      })
      .then((faces) => {
        completedInferenceMs = performance.now() - captureStartedAt
        if (disposed || generation !== inferenceGeneration || video.paused || !options.canAcceptResult()) return
        const result: FaceInferenceResult = {
          id: 0,
          type: "result",
          timestamp: now,
          faces: faces.map(face => ({
            x: face.boundingBox.x / inputWidth,
            y: face.boundingBox.y / inputHeight,
            width: face.boundingBox.width / inputWidth,
            height: face.boundingBox.height / inputHeight,
            score: face.score ?? 1,
          })),
          inferenceMs: completedInferenceMs,
        }
        if (applyInferenceResult(result, detectionMode, panoramaSample, projection, viewportCapture)) {
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
          updateInferenceSchedule(
            performance.now(),
            completedInferenceMs,
            rescanDuringMovement ? undefined : completedScheduleOverride,
          )
          options.requestRender()
        }
      })
    return true
  }

  const resetDetection = () => {
    detectionState = createFaceDetectionState()
  }

  const invalidateInference = () => {
    inferenceGeneration += 1
  }

  return {
    runDueInference(now) {
      if (!sampleContext || !shouldRunFaceInference(
        now,
        faceState.nextDetectionAt,
        faceState.isMoving,
        rescanDuringMovement,
      )) {
        return false
      }
      if (inferenceInFlight) {
        emitDiagnostic({ type: "skip" })
        updateInferenceSchedule(now)
        return true
      }
      return submitInference(now)
    },
    invalidateInference,
    resetDetection,
    resetMedia() {
      invalidateInference()
      resetDetection()
      recentInferenceTimes.length = 0
      resetCanvas(sampleCanvas)
    },
    releaseDetector() {
      detector.release()
      resetCanvas(inferenceCanvas)
      resetCanvas(sampleCanvas)
    },
    setMovementRescan(enabled) {
      rescanDuringMovement = enabled
    },
    scheduleMovementRescan(now, remainingDurationMs) {
      rescanDuringMovement = remainingDurationMs > FACE_CENTER_SHORT_MOVE_ETA_MS
      if (rescanDuringMovement) {
        faceState.nextDetectionAt = now + movingFaceInferencePeriod(remainingDurationMs, lastInferenceMs)
      }
      return rescanDuringMovement
    },
    snapshot: () => ({
      detectionState,
      activity: inferenceActivity,
      lastInferenceMs,
      rescanDuringMovement,
      inFlight: inferenceInFlight,
      detectorReady: detector.isReady(),
    }),
    destroy() {
      if (disposed) return
      disposed = true
      invalidateInference()
      detector.destroy()
      resetCanvas(inferenceCanvas)
      resetCanvas(sampleCanvas)
    },
  }
}
