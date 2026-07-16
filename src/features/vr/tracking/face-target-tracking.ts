import type { PerspectiveCamera } from "three"
import type { CameraView, ProjectionMode } from "../config"
import type { NormalizedFace } from "../detection/protocol"
import { Euler, MathUtils, Vector3 } from "three"
import { MIN_FACE_CONFIDENCE } from "../detection/protocol"
import {
  FACE_CENTER_SIZE_DEAD_ZONE,
  FACE_CENTER_TARGET_SIZE,
  getFaceForwardTarget,
  getProjectionYawLimit,
} from "./face-center-movement"

const VIEWPORT_TARGET_X = 0.5
const VIEWPORT_TARGET_Y = 1 / 3
export const FACE_DIRECTION_MAX_AGE_MS = 900
export const FACE_DIRECTION_SCAN_LEAD_MS = 160
export const FACE_DIRECTION_MAX_PREDICTION_MS = 600
export const FACE_DIRECTION_MAX_YAW_PREDICTION = 45
export const FACE_DIRECTION_MAX_PITCH_PREDICTION = 30
const TARGET_SMOOTHING_TIME_MS = 480
const FACE_IDENTITY_SWITCH_MAX_GAP_MS = 1500
export const FACE_IDENTITY_SWITCH_POSITION_SPEED = 0.8
export const FACE_IDENTITY_SWITCH_SIZE_SPEED = 1.2

export type FaceBox = NormalizedFace & { lastSeenAt: number }
export type DetectionMode = "viewport" | "panorama"
export interface FaceTarget { x: number, y: number, size?: number, yaw?: number, pitch?: number, forward?: number, mode: DetectionMode, lastSeenAt: number }
interface FaceSelectionAnchor { x: number, y: number, weight: number, wrapX: boolean }
export interface PerspectivePanoramaView { yaw: number, pitch: number, fov: number, aspect: number, yawSpan: 180 | 360 }
export interface PanoramaSample {
  center: { x: number, y: number }
  startX: number
  widthX: number
  wraps: boolean
  perspective?: PerspectivePanoramaView
}
export interface FaceMotionState {
  centerX: number
  centerY: number
  size: number
  speed: number
  recedingSpeed: number
  lastSeenAt: number
  worldYaw?: number
  worldPitch?: number
  worldYawVelocity?: number
  worldPitchVelocity?: number
  directionSamples?: number
}

export interface FaceWorldDirection { yaw: number, pitch: number }

export interface FaceAutoCenterState {
  faces: FaceBox[]
  selectedFace?: FaceBox & { mode: DetectionMode }
  detectionMode: DetectionMode
  nextDetectionAt: number
  lastDetectionAt: number
  isMoving: boolean
  offCenterSince?: number
  target?: FaceTarget
  yawVelocity: number
  pitchVelocity: number
  forwardVelocity: number
  lastErrorAt: number
  motion?: FaceMotionState
  manuallyPaused?: boolean
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const getFaceSize = (face: { width: number, height: number }) => Math.sqrt(Math.max(0, face.width * face.height))
const isFaceSizeWithinDeadZone = (size: number | undefined) => size !== undefined
  && Math.abs(size - FACE_CENTER_TARGET_SIZE) < FACE_CENTER_SIZE_DEAD_ZONE - 1e-9
const shortestAngle = (degrees: number) => ((degrees + 540) % 360) - 180
const isHalfProjection = (projection: ProjectionMode) =>
  projection === "sbs_180_eqr" || projection === "sbs_180_fe" || projection === "m_180_eqr" || projection === "m_180_fe"
const getProjectionYawSpan = (projection: ProjectionMode) => (isHalfProjection(projection) ? 180 : 360)
const getViewportTanHalfVertical = (camera: PerspectiveCamera) =>
  Math.tan(MathUtils.degToRad(camera.fov) / 2) / camera.zoom
const getViewportYawOffset = (camera: PerspectiveCamera, x: number) =>
  MathUtils.radToDeg(Math.atan((1 - x * 2) * getViewportTanHalfVertical(camera) * camera.aspect))
const getViewportPitchOffset = (camera: PerspectiveCamera, y: number) => {
  return MathUtils.radToDeg(Math.atan((1 - y * 2) * getViewportTanHalfVertical(camera)))
}

export const getFaceCenter = (face: FaceBox) => ({
  x: face.x + face.width / 2,
  y: face.y + face.height / 2,
})

export const getFaceWorldDirection = (
  face: FaceBox,
  camera: PerspectiveCamera,
  view: { yaw: number, pitch: number },
): FaceWorldDirection => {
  const center = getFaceCenter(face)
  return {
    yaw: shortestAngle(view.yaw + getViewportYawOffset(camera, center.x)),
    pitch: clamp(view.pitch + getViewportPitchOffset(camera, center.y), -90, 90),
  }
}

export const updateFaceMotion = (
  state: FaceAutoCenterState,
  face: FaceBox,
  time: number,
  camera?: PerspectiveCamera,
  view?: { yaw: number, pitch: number },
) => {
  const center = getFaceCenter(face)
  const size = getFaceSize(face)
  const direction = camera && view ? getFaceWorldDirection(face, camera, view) : undefined
  const previous = state.motion
  const elapsedMs = previous ? time - previous.lastSeenAt : 0
  if (!previous || elapsedMs <= 0 || elapsedMs > 1500) {
    state.motion = {
      centerX: center.x,
      centerY: center.y,
      size,
      speed: 0,
      recedingSpeed: 0,
      lastSeenAt: time,
      worldYaw: direction?.yaw,
      worldPitch: direction?.pitch,
      worldYawVelocity: direction ? 0 : undefined,
      worldPitchVelocity: direction ? 0 : undefined,
      directionSamples: direction ? 1 : undefined,
    }
    return state.motion
  }

  const elapsedSeconds = elapsedMs / 1000
  const measuredSpeed = clamp(Math.hypot(center.x - previous.centerX, center.y - previous.centerY) / elapsedSeconds, 0, 4)
  const measuredRecedingSpeed = clamp((previous.size - size) / elapsedSeconds, -2, 2)
  const blend = 1 - Math.exp(-elapsedMs / 350)
  const hasPreviousDirection = direction
    && previous.worldYaw !== undefined
    && previous.worldPitch !== undefined
    && previous.worldYawVelocity !== undefined
    && previous.worldPitchVelocity !== undefined
  const measuredYawVelocity = hasPreviousDirection
    ? clamp(shortestAngle(direction.yaw - previous.worldYaw!) / elapsedSeconds, -180, 180)
    : undefined
  const measuredPitchVelocity = hasPreviousDirection
    ? clamp((direction.pitch - previous.worldPitch!) / elapsedSeconds, -120, 120)
    : undefined
  state.motion = {
    centerX: center.x,
    centerY: center.y,
    size,
    speed: previous.speed + (measuredSpeed - previous.speed) * blend,
    recedingSpeed: previous.recedingSpeed + (measuredRecedingSpeed - previous.recedingSpeed) * blend,
    lastSeenAt: time,
    worldYaw: direction?.yaw,
    worldPitch: direction?.pitch,
    worldYawVelocity: measuredYawVelocity === undefined
      ? direction ? 0 : undefined
      : previous.worldYawVelocity! + (measuredYawVelocity - previous.worldYawVelocity!) * blend,
    worldPitchVelocity: measuredPitchVelocity === undefined
      ? direction ? 0 : undefined
      : previous.worldPitchVelocity! + (measuredPitchVelocity - previous.worldPitchVelocity!) * blend,
    directionSamples: direction ? (hasPreviousDirection ? (previous.directionSamples ?? 1) + 1 : 1) : undefined,
  }
  return state.motion
}

export const getPredictedFaceDirection = (
  state: FaceAutoCenterState,
  time: number,
  projection: ProjectionMode,
): FaceWorldDirection | undefined => {
  const motion = state.motion
  if (
    !motion
    || (motion.directionSamples ?? 0) < 2
    || motion.worldYaw === undefined
    || motion.worldPitch === undefined
    || motion.worldYawVelocity === undefined
    || motion.worldPitchVelocity === undefined
  ) {
    return undefined
  }
  const ageMs = time - motion.lastSeenAt
  if (ageMs < 0 || ageMs > FACE_DIRECTION_MAX_AGE_MS) return undefined
  const predictionSeconds = Math.min(
    FACE_DIRECTION_MAX_PREDICTION_MS,
    ageMs + FACE_DIRECTION_SCAN_LEAD_MS,
  ) / 1000
  const yawOffset = clamp(
    motion.worldYawVelocity * predictionSeconds,
    -FACE_DIRECTION_MAX_YAW_PREDICTION,
    FACE_DIRECTION_MAX_YAW_PREDICTION,
  )
  const pitchOffset = clamp(
    motion.worldPitchVelocity * predictionSeconds,
    -FACE_DIRECTION_MAX_PITCH_PREDICTION,
    FACE_DIRECTION_MAX_PITCH_PREDICTION,
  )
  const yawLimit = getProjectionYawLimit(projection)
  const yaw = shortestAngle(motion.worldYaw + yawOffset)
  return {
    yaw: yawLimit === undefined ? yaw : clamp(yaw, -yawLimit, yawLimit),
    pitch: clamp(motion.worldPitch + pitchOffset, -85, 85),
  }
}

export const pauseFaceAutoCenter = (state: FaceAutoCenterState) => {
  state.manuallyPaused = true
  state.faces = []
  state.selectedFace = undefined
  state.target = undefined
  state.motion = undefined
  state.offCenterSince = undefined
  state.yawVelocity = 0
  state.pitchVelocity = 0
  state.forwardVelocity = 0
  state.isMoving = false
  state.nextDetectionAt = Number.POSITIVE_INFINITY
}

export const resumeFaceAutoCenter = (state: FaceAutoCenterState) => {
  state.manuallyPaused = false
  state.nextDetectionAt = 0
}

export const FACE_CENTER_MANUAL_INPUT_RESUME_DELAY_MS = 1000

export const getFaceAutoCenterManualResumeAt = (now: number, resumeAfterViewChange: boolean) =>
  resumeAfterViewChange ? now + FACE_CENTER_MANUAL_INPUT_RESUME_DELAY_MS : Number.POSITIVE_INFINITY

export const mapSampleFaceToPanorama = (face: FaceBox, sample: PanoramaSample): FaceBox => {
  if (sample.perspective) {
    const view = sample.perspective
    const center = getFaceCenter(face)
    const tanHalfVertical = Math.tan(MathUtils.degToRad(view.fov) / 2)
    const direction = new Vector3(
      (center.x * 2 - 1) * tanHalfVertical * view.aspect,
      (1 - center.y * 2) * tanHalfVertical,
      -1,
    )
      .normalize()
      .applyEuler(new Euler(MathUtils.degToRad(view.pitch), MathUtils.degToRad(view.yaw), 0, "YXZ"))
    const yaw = MathUtils.radToDeg(Math.atan2(-direction.x, -direction.z))
    const pitch = MathUtils.radToDeg(Math.asin(clamp(direction.y, -1, 1)))
    const angularWidth = MathUtils.radToDeg(2 * Math.atan(face.width * tanHalfVertical * view.aspect))
    const angularHeight = MathUtils.radToDeg(2 * Math.atan(face.height * tanHalfVertical))
    const width = clamp(angularWidth / view.yawSpan, 0, 1)
    const height = clamp(angularHeight / 180, 0, 1)
    const rawPanoramaCenterX = 0.5 - yaw / view.yawSpan
    const panoramaCenterX = view.yawSpan === 360
      ? ((rawPanoramaCenterX % 1) + 1) % 1
      : clamp(rawPanoramaCenterX, 0, 1)
    const panoramaCenterY = clamp(0.5 - pitch / 180, 0, 1)
    return {
      ...face,
      x: view.yawSpan === 360 ? panoramaCenterX - width / 2 : clamp(panoramaCenterX - width / 2, 0, 1 - width),
      y: clamp(panoramaCenterY - height / 2, 0, 1 - height),
      width,
      height,
    }
  }
  const center = getFaceCenter(face)
  const rawCenterX = sample.startX + center.x * sample.widthX
  const panoramaCenterX = sample.wraps ? ((rawCenterX % 1) + 1) % 1 : clamp(rawCenterX, 0, 1)
  const width = face.width * sample.widthX
  return {
    ...face,
    x: sample.wraps ? panoramaCenterX - width / 2 : clamp(panoramaCenterX - width / 2, 0, 1 - width),
    width,
  }
}

const getFaceDistance = (face: FaceBox, previous: FaceBox, wrapX: boolean) => {
  const currentCenter = getFaceCenter(face)
  const previousCenter = getFaceCenter(previous)
  const rawX = Math.abs(currentCenter.x - previousCenter.x)
  return Math.hypot(wrapX ? Math.min(rawX, 1 - rawX) : rawX, Math.abs(currentCenter.y - previousCenter.y))
}

const isFaceIdentitySwitch = (
  previous: FaceBox & { mode: DetectionMode },
  next: FaceBox,
  mode: DetectionMode,
  time: number,
) => {
  const elapsedMs = time - previous.lastSeenAt
  if (previous.mode !== mode || elapsedMs <= 0 || elapsedMs > FACE_IDENTITY_SWITCH_MAX_GAP_MS) return false
  const elapsedSeconds = elapsedMs / 1000
  const positionSpeed = getFaceDistance(next, previous, mode === "panorama") / elapsedSeconds
  const previousSize = getFaceSize(previous)
  const nextSize = getFaceSize(next)
  if (!previousSize || !nextSize) return false
  const sizeSpeed = Math.abs(Math.log(nextSize / previousSize)) / elapsedSeconds
  return positionSpeed >= FACE_IDENTITY_SWITCH_POSITION_SPEED
    && sizeSpeed >= FACE_IDENTITY_SWITCH_SIZE_SPEED
}

const resetFaceIdentityHistory = (state: FaceAutoCenterState) => {
  state.target = undefined
  state.motion = undefined
  state.offCenterSince = undefined
  state.yawVelocity = 0
  state.pitchVelocity = 0
  state.forwardVelocity = 0
  state.isMoving = false
}

const getAnchorDistance = (face: FaceBox, anchor: FaceSelectionAnchor) => {
  const center = getFaceCenter(face)
  const rawX = Math.abs(center.x - anchor.x)
  return Math.hypot(anchor.wrapX ? Math.min(rawX, 1 - rawX) : rawX, Math.abs(center.y - anchor.y))
}

const selectStableFace = (
  state: FaceAutoCenterState,
  faces: FaceBox[],
  mode: DetectionMode,
  time: number,
  anchor?: FaceSelectionAnchor,
) => {
  const candidates = faces.filter(face => face.score >= MIN_FACE_CONFIDENCE)
  if (!candidates.length) return undefined
  const previous = state.selectedFace && time - state.selectedFace.lastSeenAt < 2400 ? state.selectedFace : undefined
  const wrapX = mode === "panorama"
  return candidates
    .map((face) => {
      const base = face.score * 1.2 + face.width * face.height * 2.4
      const continuity = previous && previous.mode === mode
        ? Math.max(0, 1 - getFaceDistance(face, previous, wrapX) / 0.32) * 1.6
        : 0
      const directionContinuity = anchor ? Math.max(0, 1 - getAnchorDistance(face, anchor) / 0.42) * anchor.weight : 0
      return { face, score: base + continuity + directionContinuity }
    })
    .sort((a, b) => b.score - a.score)[0]
    ?.face
}

export const applyDetections = (
  state: FaceAutoCenterState,
  faces: NormalizedFace[],
  time: number,
  mode: DetectionMode,
  anchor?: FaceSelectionAnchor,
  transformFace: (face: FaceBox) => FaceBox = face => face,
) => {
  state.lastDetectionAt = time
  state.faces = faces.map(face => ({ ...face, lastSeenAt: time }))
  const selectedFace = selectStableFace(state, state.faces.map(transformFace), mode, time, anchor)
  if (selectedFace && state.selectedFace && isFaceIdentitySwitch(state.selectedFace, selectedFace, mode, time)) {
    resetFaceIdentityHistory(state)
  }
  state.selectedFace = selectedFace ? { ...selectedFace, mode } : state.selectedFace
  return selectedFace
}

const smoothTarget = (state: FaceAutoCenterState, nextTarget: FaceTarget) => {
  const previous = state.target
  if (!previous || previous.mode !== nextTarget.mode || nextTarget.lastSeenAt - previous.lastSeenAt > 1800) {
    state.target = nextTarget
    return
  }
  const smoothing = 1 - Math.exp(-Math.max(0, nextTarget.lastSeenAt - previous.lastSeenAt) / TARGET_SMOOTHING_TIME_MS)
  state.target = {
    x: previous.x + (nextTarget.x - previous.x) * smoothing,
    y: previous.y + (nextTarget.y - previous.y) * smoothing,
    size: nextTarget.size,
    yaw: previous.yaw === undefined || nextTarget.yaw === undefined
      ? nextTarget.yaw
      : previous.yaw + shortestAngle(nextTarget.yaw - previous.yaw) * smoothing,
    pitch: previous.pitch === undefined || nextTarget.pitch === undefined
      ? nextTarget.pitch
      : previous.pitch + (nextTarget.pitch - previous.pitch) * smoothing,
    forward: previous.forward === undefined || nextTarget.forward === undefined || isFaceSizeWithinDeadZone(nextTarget.size)
      ? nextTarget.forward
      : previous.forward + (nextTarget.forward - previous.forward) * smoothing,
    mode: nextTarget.mode,
    lastSeenAt: nextTarget.lastSeenAt,
  }
}

export const setViewportTarget = (
  state: FaceAutoCenterState,
  face: FaceBox | undefined,
  time: number,
  camera: PerspectiveCamera,
  view: Pick<CameraView, "yaw" | "pitch" | "forward">,
  center = face ? getFaceCenter(face) : undefined,
  surfaceDistance = 100,
) => {
  if (!face || !center) return false
  const yawOffset = getViewportYawOffset(camera, center.x) - getViewportYawOffset(camera, VIEWPORT_TARGET_X)
  const pitchOffset = getViewportPitchOffset(camera, center.y) - getViewportPitchOffset(camera, VIEWPORT_TARGET_Y)
  smoothTarget(state, {
    x: center.x - VIEWPORT_TARGET_X,
    y: center.y - VIEWPORT_TARGET_Y,
    size: getFaceSize(face),
    yaw: view.yaw + yawOffset,
    pitch: clamp(view.pitch + pitchOffset, -85, 85),
    forward: getFaceForwardTarget(face, view.forward, surfaceDistance),
    mode: "viewport",
    lastSeenAt: time,
  })
  return true
}

export const setPanoramaTarget = (
  state: FaceAutoCenterState,
  face: FaceBox | undefined,
  time: number,
  projection: ProjectionMode,
  camera: PerspectiveCamera,
) => {
  if (!face) return false
  const center = getFaceCenter(face)
  const yawLimit = getProjectionYawLimit(projection)
  const yaw = (VIEWPORT_TARGET_X - center.x) * getProjectionYawSpan(projection)
  smoothTarget(state, {
    x: center.x - VIEWPORT_TARGET_X,
    y: center.y - VIEWPORT_TARGET_Y,
    yaw: yawLimit === undefined ? yaw : clamp(yaw, -yawLimit, yawLimit),
    pitch: clamp((0.5 - center.y) * 180 - getViewportPitchOffset(camera, VIEWPORT_TARGET_Y), -75, 75),
    mode: "panorama",
    lastSeenAt: time,
  })
  return true
}
