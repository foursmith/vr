import type { ProjectionMode } from "@foursmith/player-core"
import type { PerspectiveCamera } from "three"
import type { FaceDetectionRange, FaceInferenceMode, NormalizedFace } from "../face-tracking/protocol"
import { Euler, MathUtils, Vector3 } from "three"

const VIEWPORT_TARGET_X = 0.5
const VIEWPORT_TARGET_Y = 1 / 3
export const FACE_CENTER_VIEWPORT_ACTIVATION_THRESHOLD = 0.08
export const FACE_CENTER_VIEWPORT_SETTLE_THRESHOLD = 0.05
export const FACE_CENTER_PANORAMA_ACTIVATION_DEGREES = 10
export const FACE_CENTER_PANORAMA_SETTLE_DEGREES = 7
export const FACE_CENTER_VIEWPORT_MAX_SPEED = 18
export const FACE_CENTER_PANORAMA_MAX_SPEED = 32
export const FACE_CENTER_TARGET_SIZE = 0.24
export const FACE_CENTER_MIN_FORWARD = -35
export const FACE_CENTER_MAX_FORWARD = 35
export const FACE_CENTER_FORWARD_ACTIVATION_DISTANCE = 3
export const FACE_CENTER_FORWARD_SETTLE_DISTANCE = 1.5
export const FACE_CENTER_FORWARD_MAX_SPEED = 16
export const FACE_CENTER_EDGE_MARGIN_DEGREES = 2
export const FACE_PITCH_LOOK_DEAD_ZONE_DEGREES = 6
export const FACE_PITCH_LOOK_FULL_SCALE_DEGREES = 30
export const FACE_PITCH_LOOK_MAX_VIEWPORT_OFFSET = 0.12
export const VIEWPORT_MISSES_BEFORE_PANORAMA = 2
export const FACE_DIRECTION_MAX_AGE_MS = 900
export const FACE_DIRECTION_SCAN_LEAD_MS = 160
export const FACE_DIRECTION_MAX_PREDICTION_MS = 600
export const FACE_DIRECTION_MAX_YAW_PREDICTION = 45
export const FACE_DIRECTION_MAX_PITCH_PREDICTION = 30
const FACE_CENTER_VIEWPORT_DISTANCE_SCALE = 22
const FACE_CENTER_PANORAMA_DISTANCE_SCALE = 45
const FACE_CENTER_FORWARD_DISTANCE_SCALE = 18
const MIN_FACE_SCORE = 0.5
const TARGET_SMOOTHING_TIME_MS = 480
const FACE_IDENTITY_SWITCH_MAX_GAP_MS = 1500
export const FACE_IDENTITY_SWITCH_POSITION_SPEED = 0.8
export const FACE_IDENTITY_SWITCH_SIZE_SPEED = 1.2

export type FaceBox = NormalizedFace & { lastSeenAt: number }
export type DetectionMode = "viewport" | "panorama"
export const getFaceDetectionRange = (mode: DetectionMode): FaceDetectionRange => mode === "viewport" ? "short" : "full"
export const getFaceInferenceMode = (
  mode: DetectionMode,
  hasReliableTarget: boolean,
  faceTrackingPro: boolean,
): FaceInferenceMode => mode === "viewport" && hasReliableTarget && faceTrackingPro ? "landmarks" : "detection"
export interface FaceTarget { x: number, y: number, yaw?: number, pitch?: number, forward?: number, mode: DetectionMode, lastSeenAt: number }
export interface FaceCenteringError {
  yaw: number
  pitch: number
  forward: number
  yawOffset: number
  pitchOffset: number
  forwardOffset: number
  needsMovement: boolean
}
export interface FaceMovementHint {
  text: string
  horizontal?: { direction: "left" | "right", value: string }
  vertical?: { direction: "up" | "down", value: string }
  depth?: "nearer" | "farther"
  depthValue?: string
}
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
  recoveryMode?: DetectionMode
  consecutiveMisses: number
  consecutiveViewportMisses: number
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
const shortestAngle = (degrees: number) => ((degrees + 540) % 360) - 180
const isHalfProjection = (projection: ProjectionMode) =>
  projection === "sbs_180_eqr" || projection === "sbs_180_fe" || projection === "m_180_eqr" || projection === "m_180_fe"
const getProjectionYawSpan = (projection: ProjectionMode) => (isHalfProjection(projection) ? 180 : 360)
export const getProjectionYawLimit = (projection: ProjectionMode) => (isHalfProjection(projection) ? 86 : undefined)
const getViewportTanHalfVertical = (camera: PerspectiveCamera) =>
  Math.tan(MathUtils.degToRad(camera.fov) / 2) / camera.zoom
const getViewportYawOffset = (camera: PerspectiveCamera, x: number) =>
  MathUtils.radToDeg(Math.atan((1 - x * 2) * getViewportTanHalfVertical(camera) * camera.aspect))
const getViewportPitchOffset = (camera: PerspectiveCamera, y: number) => {
  return MathUtils.radToDeg(Math.atan((1 - y * 2) * getViewportTanHalfVertical(camera)))
}

const VIEWPORT_EDGE_STEPS = [-1, -0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75, 1]
const VIEWPORT_EDGE_SAMPLES = [
  ...VIEWPORT_EDGE_STEPS.flatMap(y => [{ x: -1, y }, { x: 1, y }]),
  ...VIEWPORT_EDGE_STEPS.slice(1, -1).flatMap(x => [{ x, y: -1 }, { x, y: 1 }]),
]

export const getProjectionCoverageMargin = (
  projection: ProjectionMode,
  camera: PerspectiveCamera,
  view: { yaw: number, pitch: number, forward: number },
) => {
  if (!isHalfProjection(projection)) return Number.POSITIVE_INFINITY

  const rotation = new Euler(
    MathUtils.degToRad(view.pitch),
    MathUtils.degToRad(view.yaw),
    0,
    "YXZ",
  )
  const cameraPosition = new Vector3(0, 0, -1)
    .applyEuler(rotation)
    .multiplyScalar(view.forward)
  const direction = new Vector3()
  const surfacePoint = new Vector3()
  const tanHalfVertical = getViewportTanHalfVertical(camera)
  // The fisheye back-half mask sits one unit inside the video sphere, so its
  // curved silhouette can occlude the video before a ray reaches radius 100.
  const coverageSurfaceRadius = projection === "sbs_180_fe" || projection === "m_180_fe" ? 99 : 100
  let margin = Number.POSITIVE_INFINITY

  for (const { x, y } of VIEWPORT_EDGE_SAMPLES) {
    direction
      .set(x * tanHalfVertical * camera.aspect, y * tanHalfVertical, -1)
      .normalize()
      .applyEuler(rotation)
    const cameraAlongRay = cameraPosition.dot(direction)
    const discriminant
      = cameraAlongRay * cameraAlongRay + coverageSurfaceRadius ** 2 - cameraPosition.lengthSq()
    if (discriminant < 0) return Number.NEGATIVE_INFINITY
    const distance = -cameraAlongRay + Math.sqrt(discriminant)
    surfacePoint.copy(direction).multiplyScalar(distance).add(cameraPosition)
    const hemisphereDistance = MathUtils.radToDeg(Math.asin(clamp(
      -surfacePoint.z / coverageSurfaceRadius,
      -1,
      1,
    )))
    margin = Math.min(margin, hemisphereDistance - FACE_CENTER_EDGE_MARGIN_DEGREES)
  }

  return margin
}

export const constrainFaceAutoCenterView = (
  projection: ProjectionMode,
  camera: PerspectiveCamera,
  current: { yaw: number, pitch: number, forward: number },
  proposed: { yaw: number, pitch: number, forward: number },
) => {
  if (!isHalfProjection(projection)) return proposed
  const currentMargin = getProjectionCoverageMargin(projection, camera, current)
  const proposedMargin = getProjectionCoverageMargin(projection, camera, proposed)
  if (proposedMargin >= 0 || (currentMargin < 0 && proposedMargin > currentMargin)) return proposed
  if (currentMargin < 0) return current

  let safe = 0
  let unsafe = 1
  for (let index = 0; index < 12; index += 1) {
    const fraction = (safe + unsafe) / 2
    const candidate = {
      yaw: current.yaw + shortestAngle(proposed.yaw - current.yaw) * fraction,
      pitch: current.pitch + (proposed.pitch - current.pitch) * fraction,
      forward: current.forward + (proposed.forward - current.forward) * fraction,
    }
    if (getProjectionCoverageMargin(projection, camera, candidate) >= 0) safe = fraction
    else unsafe = fraction
  }

  return {
    yaw: current.yaw + shortestAngle(proposed.yaw - current.yaw) * safe,
    pitch: current.pitch + (proposed.pitch - current.pitch) * safe,
    forward: current.forward + (proposed.forward - current.forward) * safe,
  }
}

export const getFaceCenteringError = (
  target: FaceTarget,
  camera: PerspectiveCamera,
  view: { yaw: number, pitch: number, forward: number },
  moving = false,
): FaceCenteringError => {
  const viewportFaceX = VIEWPORT_TARGET_X + target.x
  const viewportFaceY = VIEWPORT_TARGET_Y + target.y
  const yaw = target.yaw === undefined
    ? getViewportYawOffset(camera, viewportFaceX) - getViewportYawOffset(camera, VIEWPORT_TARGET_X)
    : shortestAngle(target.yaw - view.yaw)
  const pitch = target.pitch === undefined
    ? getViewportPitchOffset(camera, viewportFaceY) - getViewportPitchOffset(camera, VIEWPORT_TARGET_Y)
    : target.pitch - view.pitch
  const viewportThreshold = moving ? FACE_CENTER_VIEWPORT_SETTLE_THRESHOLD : FACE_CENTER_VIEWPORT_ACTIVATION_THRESHOLD
  const panoramaThreshold = moving ? FACE_CENTER_PANORAMA_SETTLE_DEGREES : FACE_CENTER_PANORAMA_ACTIVATION_DEGREES
  const yawDeadZone = target.mode === "viewport"
    ? Math.abs(getViewportYawOffset(camera, VIEWPORT_TARGET_X + viewportThreshold) - getViewportYawOffset(camera, VIEWPORT_TARGET_X))
    : panoramaThreshold
  const pitchDeadZone = target.mode === "viewport"
    ? Math.abs(getViewportPitchOffset(camera, VIEWPORT_TARGET_Y + viewportThreshold) - getViewportPitchOffset(camera, VIEWPORT_TARGET_Y))
    : panoramaThreshold
  const forward = target.forward === undefined ? 0 : target.forward - view.forward
  const forwardDeadZone = moving ? FACE_CENTER_FORWARD_SETTLE_DISTANCE : FACE_CENTER_FORWARD_ACTIVATION_DISTANCE
  const yawOffset = Math.sign(yaw) * Math.max(0, Math.abs(yaw) - yawDeadZone)
  const pitchOffset = Math.sign(pitch) * Math.max(0, Math.abs(pitch) - pitchDeadZone)
  const forwardOffset = Math.sign(forward) * Math.max(0, Math.abs(forward) - forwardDeadZone)
  return {
    yaw,
    pitch,
    forward,
    yawOffset,
    pitchOffset,
    forwardOffset,
    needsMovement: yawOffset !== 0 || pitchOffset !== 0 || forwardOffset !== 0,
  }
}

export const getFaceCenteringVelocity = (offset: number, mode: DetectionMode) => {
  const distance = Math.abs(offset)
  if (!distance) return 0
  const maxSpeed = mode === "panorama" ? FACE_CENTER_PANORAMA_MAX_SPEED : FACE_CENTER_VIEWPORT_MAX_SPEED
  const distanceScale = mode === "panorama" ? FACE_CENTER_PANORAMA_DISTANCE_SCALE : FACE_CENTER_VIEWPORT_DISTANCE_SCALE
  return Math.sign(offset) * maxSpeed * (1 - Math.exp(-distance / distanceScale))
}

export const getFaceForwardVelocity = (offset: number) => {
  const distance = Math.abs(offset)
  if (!distance) return 0
  return Math.sign(offset) * FACE_CENTER_FORWARD_MAX_SPEED * (1 - Math.exp(-distance / FACE_CENTER_FORWARD_DISTANCE_SCALE))
}

export const getManualZoomForwardTarget = (currentForward: number, scale: number, surfaceDistance: number) =>
  surfaceDistance - (surfaceDistance - currentForward) / Math.max(Number.EPSILON, scale)

export const getFaceForwardTarget = (
  face: FaceBox,
  currentForward: number,
  surfaceDistance: number,
) => {
  const size = Math.sqrt(Math.max(0, face.width * face.height))
  if (!size) return currentForward
  const remainingDistance = Math.max(1, surfaceDistance - currentForward)
  return clamp(
    surfaceDistance - remainingDistance * size / FACE_CENTER_TARGET_SIZE,
    FACE_CENTER_MIN_FORWARD,
    FACE_CENTER_MAX_FORWARD,
  )
}

export const getFaceMovementHint = (error: FaceCenteringError): FaceMovementHint | undefined => {
  const labels: string[] = []
  if (error.yawOffset) labels.push(`${error.yaw > 0 ? "→" : "←"} ${Math.round(Math.abs(error.yaw))}°`)
  if (error.pitchOffset) labels.push(`${error.pitch > 0 ? "↑" : "↓"} ${Math.round(Math.abs(error.pitch))}°`)
  if (error.forwardOffset) labels.push(`${error.forward > 0 ? "nearer" : "farther"} ${Math.abs(error.forward).toFixed(1)}`)
  if (!labels.length && !error.forwardOffset) return undefined
  return {
    text: labels.join(" · "),
    horizontal: error.yawOffset
      ? { direction: error.yaw > 0 ? "right" : "left", value: `${Math.round(Math.abs(error.yaw))}°` }
      : undefined,
    vertical: error.pitchOffset
      ? { direction: error.pitch > 0 ? "up" : "down", value: `${Math.round(Math.abs(error.pitch))}°` }
      : undefined,
    depth: error.forwardOffset ? (error.forward > 0 ? "nearer" : "farther") : undefined,
    depthValue: error.forwardOffset ? Math.abs(error.forward).toFixed(1) : undefined,
  }
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

export const getFacePitchAdjustedCenter = (
  center: { x: number, y: number },
  pitch: number | undefined,
) => {
  if (pitch === undefined || !Number.isFinite(pitch)) return center
  const magnitude = Math.abs(pitch)
  if (magnitude <= FACE_PITCH_LOOK_DEAD_ZONE_DEGREES) return center
  const strength = clamp(
    (magnitude - FACE_PITCH_LOOK_DEAD_ZONE_DEGREES)
    / (FACE_PITCH_LOOK_FULL_SCALE_DEGREES - FACE_PITCH_LOOK_DEAD_ZONE_DEGREES),
    0,
    1,
  )
  return {
    x: center.x,
    y: clamp(center.y + Math.sign(pitch) * FACE_PITCH_LOOK_MAX_VIEWPORT_OFFSET * strength, 0, 1),
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
  const size = Math.sqrt(Math.max(0, face.width * face.height))
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
  state.recoveryMode = undefined
  state.consecutiveMisses = 0
  state.consecutiveViewportMisses = 0
  state.offCenterSince = undefined
  state.yawVelocity = 0
  state.pitchVelocity = 0
  state.forwardVelocity = 0
  state.isMoving = false
  state.nextDetectionAt = Number.POSITIVE_INFINITY
}

export const shouldEnterPanoramaRecovery = (consecutiveViewportMisses: number) =>
  consecutiveViewportMisses >= VIEWPORT_MISSES_BEFORE_PANORAMA

export const resumeFaceAutoCenter = (state: FaceAutoCenterState) => {
  state.manuallyPaused = false
  state.nextDetectionAt = 0
}

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
  const previousSize = Math.sqrt(Math.max(0, previous.width * previous.height))
  const nextSize = Math.sqrt(Math.max(0, next.width * next.height))
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
  const candidates = faces.filter(face => face.score >= MIN_FACE_SCORE)
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
    yaw: previous.yaw === undefined || nextTarget.yaw === undefined
      ? nextTarget.yaw
      : previous.yaw + shortestAngle(nextTarget.yaw - previous.yaw) * smoothing,
    pitch: previous.pitch === undefined || nextTarget.pitch === undefined
      ? nextTarget.pitch
      : previous.pitch + (nextTarget.pitch - previous.pitch) * smoothing,
    forward: previous.forward === undefined || nextTarget.forward === undefined
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
  center = face ? getFaceCenter(face) : undefined,
  currentForward = 0,
  surfaceDistance = 100,
) => {
  if (!face || !center) return false
  smoothTarget(state, {
    x: center.x - VIEWPORT_TARGET_X,
    y: center.y - VIEWPORT_TARGET_Y,
    forward: getFaceForwardTarget(face, currentForward, surfaceDistance),
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
