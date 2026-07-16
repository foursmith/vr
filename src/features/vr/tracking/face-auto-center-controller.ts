import type { PerspectiveCamera } from "three"
import type { CameraView, ProjectionMode } from "../config"
import type { FaceMovementHint } from "./face-center-movement"
import type { FaceScanCapturePort, FaceScanDiagnosticEvent } from "./face-scan-controller"
import type { FaceAutoCenterState } from "./face-target-tracking"
import type { FaceInferenceActivity } from "./inference-schedule-policy"
import { createFaceDetectorService } from "../detection/face-detector-service"
import {
  advanceFaceMovement,
  getFaceCenteringPlan,
} from "./face-center-movement"
import {
  getFaceDetectionRetryAt,
} from "./face-detection-state"
import { createFaceScanController } from "./face-scan-controller"
import { getFaceAutoCenterManualResumeAt, pauseFaceAutoCenter, resumeFaceAutoCenter } from "./face-target-tracking"

export interface FaceAutoCenterControllerOptions {
  video: HTMLVideoElement
  camera: PerspectiveCamera
  sampleCanvas: HTMLCanvasElement
  capture: FaceScanCapturePort
  getProjection: () => ProjectionMode
  getFrameRate: () => number
  getView: () => CameraView
  getEnabled: () => boolean
  getHidden: () => boolean
  getResumeAfterViewChange: () => boolean
  getDebugEnabled: () => boolean
  getSurfaceDistance: (projection: ProjectionMode) => number
  onDiagnosticEvent: (event: FaceScanDiagnosticEvent) => void
  onOverlayHint: (hint?: FaceMovementHint) => void
  onPauseChange: (paused: boolean) => void
  onBoundaryWarning: (axis: "yaw" | "pitch" | "forward") => void
  requestRender: () => void
}

export interface FaceAutoCenterControllerSnapshot {
  activity: FaceInferenceActivity
  phase: string
  retryAt: number
  isMoving: boolean
  rescanDuringMovement: boolean
  detectorActive: boolean
  target?: {
    mode: string
    yaw?: number
    pitch?: number
    forward?: number
  }
  error?: { yaw: number, pitch: number, forward: number }
  blockedAxis?: "yaw" | "pitch" | "forward"
  motion?: { size: number, speed: number, recedingSpeed: number, lastSeenAt: number }
  velocity: { forward: number }
}

export interface FaceAutoCenterController {
  runAfterRender: (now: number, delta: number) => void
  pauseForManualInput: () => void
  resume: () => void
  handleVideoPause: () => void
  handleMetadata: () => void
  invalidateInference: () => void
  requestDetection: () => void
  setResumeAfterViewChange: (enabled: boolean) => void
  setEnabled: (enabled: boolean) => void
  resetMedia: () => void
  isMoving: () => boolean
  snapshot: () => FaceAutoCenterControllerSnapshot
  destroy: () => void
}

export const createFaceAutoCenterController = (
  options: FaceAutoCenterControllerOptions,
): FaceAutoCenterController => {
  const faceState: FaceAutoCenterState = {
    faces: [],
    detectionMode: "viewport" as const,
    nextDetectionAt: 0,
    lastDetectionAt: 0,
    isMoving: false,
    yawVelocity: 0,
    pitchVelocity: 0,
    forwardVelocity: 0,
    lastErrorAt: 0,
  }
  const detector = createFaceDetectorService()
  let disposed = false
  let temporaryManualPauseActive = false
  let manualResumeTimer: number | undefined
  let automaticBoundaryAxis: "yaw" | "pitch" | "forward" | undefined

  const scanner = createFaceScanController({
    video: options.video,
    camera: options.camera,
    faceState,
    detector,
    sampleCanvas: options.sampleCanvas,
    capture: options.capture,
    getProjection: options.getProjection,
    getFrameRate: options.getFrameRate,
    getView: options.getView,
    getSurfaceDistance: options.getSurfaceDistance,
    isDebugEnabled: options.getDebugEnabled,
    canAcceptResult: () => !disposed && options.getEnabled() && !options.getHidden(),
    onDiagnosticEvent: options.onDiagnosticEvent,
    requestRender: options.requestRender,
  })

  const hideOverlay = () => options.onOverlayHint()

  const clearManualResume = () => {
    if (manualResumeTimer !== undefined) window.clearTimeout(manualResumeTimer)
    manualResumeTimer = undefined
    if (temporaryManualPauseActive) options.getView().pausedUntil = 0
    temporaryManualPauseActive = false
  }

  const setManuallyPaused = (paused: boolean) => {
    if (paused === Boolean(faceState.manuallyPaused)) return
    scanner.invalidateInference()
    if (paused) pauseFaceAutoCenter(faceState)
    else resumeFaceAutoCenter(faceState)
    automaticBoundaryAxis = undefined
    scanner.resetDetection()
    options.onPauseChange(paused)
    hideOverlay()
    options.requestRender()
  }

  const clearTracking = () => {
    faceState.faces = []
    faceState.target = undefined
    faceState.motion = undefined
    scanner.resetDetection()
    faceState.yawVelocity = 0
    faceState.pitchVelocity = 0
    faceState.forwardVelocity = 0
    faceState.isMoving = false
    automaticBoundaryAxis = undefined
    hideOverlay()
  }

  const pauseForManualInput = () => {
    if (!options.getEnabled()) return
    const now = performance.now()
    const resumeAt = getFaceAutoCenterManualResumeAt(now, options.getResumeAfterViewChange())
    if (!Number.isFinite(resumeAt)) {
      clearManualResume()
      setManuallyPaused(true)
      return
    }

    if (!temporaryManualPauseActive) {
      temporaryManualPauseActive = true
      const wasManuallyPaused = Boolean(faceState.manuallyPaused)
      scanner.invalidateInference()
      pauseFaceAutoCenter(faceState)
      resumeFaceAutoCenter(faceState)
      automaticBoundaryAxis = undefined
      scanner.resetDetection()
      if (wasManuallyPaused) options.onPauseChange(false)
      hideOverlay()
    }
    options.getView().pausedUntil = resumeAt
    if (manualResumeTimer !== undefined) window.clearTimeout(manualResumeTimer)
    manualResumeTimer = window.setTimeout(() => {
      manualResumeTimer = undefined
      if (disposed || !temporaryManualPauseActive) return
      temporaryManualPauseActive = false
      options.getView().pausedUntil = 0
      faceState.nextDetectionAt = 0
      options.requestRender()
    }, Math.max(0, resumeAt - performance.now()))
    options.requestRender()
  }

  const runAfterRender = (now: number, delta: number) => {
    if (options.video.paused) {
      faceState.yawVelocity = 0
      faceState.pitchVelocity = 0
      faceState.forwardVelocity = 0
      faceState.isMoving = false
      automaticBoundaryAxis = undefined
      hideOverlay()
      return
    }

    if (!options.getEnabled() || options.getHidden()) {
      clearTracking()
      return
    }

    if (!options.video.videoWidth
      || !options.video.videoHeight
      || options.video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      clearTracking()
      return
    }

    if (faceState.manuallyPaused || now < options.getView().pausedUntil) return

    scanner.runDueInference(now)
    const movement = advanceFaceMovement({
      now,
      delta,
      state: faceState,
      view: options.getView(),
      projection: options.getProjection(),
      camera: options.camera,
    })
    automaticBoundaryAxis = movement.settledBoundaryAxis
    if (automaticBoundaryAxis && options.getDebugEnabled()) {
      options.onBoundaryWarning(automaticBoundaryAxis)
    }
    options.onOverlayHint(movement.hint)
    if (movement.started) {
      scanner.scheduleMovementRescan(now, movement.movementDurationMs)
    } else if (movement.stopped) {
      scanner.setMovementRescan(false)
      faceState.nextDetectionAt = 0
    }
  }

  return {
    runAfterRender,
    pauseForManualInput,
    resume: () => setManuallyPaused(false),
    handleVideoPause() {
      scanner.invalidateInference()
      clearTracking()
      options.requestRender()
    },
    handleMetadata() {
      faceState.motion = undefined
      scanner.resetDetection()
      faceState.nextDetectionAt = 0
    },
    invalidateInference: scanner.invalidateInference,
    requestDetection: () => (faceState.nextDetectionAt = 0),
    setResumeAfterViewChange(enabled) {
      if (!enabled && temporaryManualPauseActive) {
        clearManualResume()
        setManuallyPaused(true)
      }
    },
    setEnabled(enabled) {
      scanner.invalidateInference()
      if (enabled) return
      scanner.releaseDetector()
      clearManualResume()
      if (faceState.manuallyPaused) setManuallyPaused(false)
    },
    resetMedia() {
      scanner.resetMedia()
      clearManualResume()
      if (faceState.manuallyPaused) {
        resumeFaceAutoCenter(faceState)
        options.onPauseChange(false)
      }
      faceState.faces = []
      faceState.target = undefined
      faceState.motion = undefined
      faceState.isMoving = false
      faceState.yawVelocity = 0
      faceState.pitchVelocity = 0
      faceState.forwardVelocity = 0
      faceState.nextDetectionAt = 0
      automaticBoundaryAxis = undefined
      hideOverlay()
    },
    isMoving: () => faceState.isMoving,
    snapshot() {
      const scan = scanner.snapshot()
      const plan = faceState.target
        ? getFaceCenteringPlan(
            faceState.target,
            options.camera,
            options.getView(),
            options.getProjection(),
            faceState.isMoving,
          )
        : undefined
      return {
        activity: scan.activity,
        phase: scan.detectionState.phase,
        retryAt: getFaceDetectionRetryAt(scan.detectionState),
        isMoving: faceState.isMoving,
        rescanDuringMovement: scan.rescanDuringMovement,
        detectorActive: scan.detectorReady,
        target: faceState.target && {
          mode: faceState.target.mode,
          yaw: faceState.target.yaw,
          pitch: faceState.target.pitch,
          forward: faceState.target.forward,
        },
        error: plan && {
          yaw: plan.error.yawOffset,
          pitch: plan.error.pitchOffset,
          forward: plan.error.forwardOffset,
        },
        blockedAxis: plan?.blockedAxis ?? automaticBoundaryAxis,
        motion: faceState.motion && {
          size: faceState.motion.size,
          speed: faceState.motion.speed,
          recedingSpeed: faceState.motion.recedingSpeed,
          lastSeenAt: faceState.motion.lastSeenAt,
        },
        velocity: { forward: faceState.forwardVelocity },
      }
    },
    destroy() {
      if (disposed) return
      disposed = true
      clearManualResume()
      scanner.destroy()
    },
  }
}
