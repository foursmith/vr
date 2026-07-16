import type { PerspectiveCamera } from "three"
import type { CameraView, ProjectionMode } from "../config"
import type { DetectionMode, FaceAutoCenterState, FaceBox, FaceTarget } from "./face-target-tracking"
import { Euler, MathUtils, Vector3 } from "three"

const VIEWPORT_TARGET_X = 0.5
const VIEWPORT_TARGET_Y = 1 / 3
export const FACE_CENTER_VIEWPORT_ACTIVATION_THRESHOLD = 0.08
export const FACE_CENTER_VIEWPORT_SETTLE_THRESHOLD = 0.05
export const FACE_CENTER_PANORAMA_ACTIVATION_DEGREES = 10
export const FACE_CENTER_PANORAMA_SETTLE_DEGREES = 7
export const FACE_CENTER_VIEWPORT_MAX_SPEED = 18
export const FACE_CENTER_PANORAMA_MAX_SPEED = 32
export const FACE_CENTER_TARGET_SIZE = 0.18
export const FACE_CENTER_SIZE_DEAD_ZONE = 0.02
export const FACE_CENTER_MAX_FORWARD = 35
export const FACE_CENTER_FORWARD_ACTIVATION_DISTANCE = 3
export const FACE_CENTER_FORWARD_SETTLE_DISTANCE = 1.5
export const FACE_CENTER_FORWARD_MAX_SPEED = 16
export const FACE_CENTER_VELOCITY_SMOOTHING_MS = 260
export const FACE_CENTER_STOP_SPEED = 0.025
const FACE_CENTER_ETA_SETTLE_OFFSET = 0.01
const FACE_CENTER_PLAN_EPSILON = 0.001
export const FACE_CENTER_EDGE_MARGIN_DEGREES = 2
const FACE_CENTER_VIEWPORT_DISTANCE_SCALE = 22
const FACE_CENTER_PANORAMA_DISTANCE_SCALE = 45
const FACE_CENTER_FORWARD_DISTANCE_SCALE = 18

export interface FaceCenteringError {
  yaw: number
  pitch: number
  forward: number
  yawOffset: number
  pitchOffset: number
  forwardOffset: number
  needsMovement: boolean
}
export type FaceCenteringAxis = "yaw" | "pitch" | "forward"
export interface FaceCenteringPlan {
  error: FaceCenteringError
  desiredView: { yaw: number, pitch: number, forward: number }
  targetView: { yaw: number, pitch: number, forward: number }
  blockedAxis?: FaceCenteringAxis
}
export interface FaceMovementHint {
  text: string
  horizontal?: { direction: "left" | "right", value: string }
  vertical?: { direction: "up" | "down", value: string }
  depth?: "nearer" | "farther"
  depthValue?: string
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const getFaceSize = (face: { width: number, height: number }) => Math.sqrt(Math.max(0, face.width * face.height))
const isFaceSizeWithinDeadZone = (size: number | undefined) => size !== undefined
  && Math.abs(size - FACE_CENTER_TARGET_SIZE) < FACE_CENTER_SIZE_DEAD_ZONE - 1e-9
const shortestAngle = (degrees: number) => ((degrees + 540) % 360) - 180
const isHalfProjection = (projection: ProjectionMode) =>
  projection === "sbs_180_eqr" || projection === "sbs_180_fe" || projection === "m_180_eqr" || projection === "m_180_fe"
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
  for (let index = 0; index < 20; index += 1) {
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

const getProjectionRecoveryForward = (
  projection: ProjectionMode,
  camera: PerspectiveCamera,
  current: { yaw: number, pitch: number, forward: number },
  targetDirection: { yaw: number, pitch: number },
) => {
  const targetAt = (forward: number) => ({ ...targetDirection, forward })
  if (getProjectionCoverageMargin(projection, camera, targetAt(current.forward)) >= 0) return current.forward
  if (getProjectionCoverageMargin(projection, camera, targetAt(FACE_CENTER_MAX_FORWARD)) < 0) {
    return FACE_CENTER_MAX_FORWARD
  }

  let blocked = current.forward
  let safe = FACE_CENTER_MAX_FORWARD
  for (let index = 0; index < 12; index += 1) {
    const forward = (blocked + safe) / 2
    if (getProjectionCoverageMargin(projection, camera, targetAt(forward)) >= 0) safe = forward
    else blocked = forward
  }
  return safe
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
  const forward = target.forward === undefined || isFaceSizeWithinDeadZone(target.size) ? 0 : target.forward - view.forward
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

export const getFaceCenteringPlan = (
  target: FaceTarget,
  camera: PerspectiveCamera,
  view: { yaw: number, pitch: number, forward: number },
  projection: ProjectionMode,
  moving = false,
): FaceCenteringPlan => {
  const rawError = getFaceCenteringError(target, camera, view, moving)
  const recoveryForward = target.mode === "panorama" && (rawError.yawOffset || rawError.pitchOffset)
    ? getProjectionRecoveryForward(projection, camera, view, {
        yaw: view.yaw + rawError.yawOffset,
        pitch: view.pitch + rawError.pitchOffset,
      })
    : view.forward
  const desiredView = {
    yaw: view.yaw + rawError.yawOffset,
    pitch: clamp(view.pitch + rawError.pitchOffset, -85, 85),
    forward: rawError.forwardOffset ? view.forward + rawError.forwardOffset : recoveryForward,
  }
  const targetView = constrainFaceAutoCenterView(projection, camera, view, desiredView)
  const blockedOffsets: Record<FaceCenteringAxis, number> = {
    yaw: Math.abs(shortestAngle(desiredView.yaw - targetView.yaw)),
    pitch: Math.abs(desiredView.pitch - targetView.pitch),
    forward: Math.abs(desiredView.forward - targetView.forward),
  }
  const blockedAxis = (Object.entries(blockedOffsets) as Array<[FaceCenteringAxis, number]>)
    .filter(([, offset]) => offset > 0.001)
    .sort((first, second) => second[1] - first[1])[0]?.[0]
  const normalizeOffset = (offset: number) => Math.abs(offset) < FACE_CENTER_PLAN_EPSILON ? 0 : offset
  const yawOffset = normalizeOffset(shortestAngle(targetView.yaw - view.yaw))
  const pitchOffset = normalizeOffset(targetView.pitch - view.pitch)
  const forwardOffset = normalizeOffset(targetView.forward - view.forward)
  return {
    desiredView,
    targetView,
    blockedAxis,
    error: {
      yaw: rawError.yaw,
      pitch: rawError.pitch,
      forward: desiredView.forward - view.forward,
      yawOffset,
      pitchOffset,
      forwardOffset,
      needsMovement: yawOffset !== 0 || pitchOffset !== 0 || forwardOffset !== 0,
    },
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

export const smoothFaceCenteringVelocity = (current: number, desired: number, elapsedMs: number) => {
  const blend = 1 - Math.exp(-elapsedMs / FACE_CENTER_VELOCITY_SMOOTHING_MS)
  const next = current + (desired - current) * blend
  return Math.abs(next) < FACE_CENTER_STOP_SPEED && Math.abs(desired) < FACE_CENTER_STOP_SPEED ? 0 : next
}

export const estimateFaceCenteringDuration = (
  error: Pick<FaceCenteringError, "yawOffset" | "pitchOffset" | "forwardOffset">,
  velocity: { yaw: number, pitch: number, forward: number },
  mode: DetectionMode,
) => {
  const stepMs = 16
  const stepSeconds = stepMs / 1000
  let yawOffset = error.yawOffset
  let pitchOffset = error.pitchOffset
  let forwardOffset = error.forwardOffset
  const yawSettleOffset = Math.max(FACE_CENTER_ETA_SETTLE_OFFSET, Math.abs(yawOffset) * 0.05)
  const pitchSettleOffset = Math.max(FACE_CENTER_ETA_SETTLE_OFFSET, Math.abs(pitchOffset) * 0.05)
  const forwardSettleOffset = Math.max(FACE_CENTER_ETA_SETTLE_OFFSET, Math.abs(forwardOffset) * 0.05)
  let yawVelocity = velocity.yaw
  let pitchVelocity = velocity.pitch
  let forwardVelocity = velocity.forward
  const advanceAxis = (offset: number, currentVelocity: number, desiredVelocity: number, settleOffset: number) => {
    if (Math.abs(offset) <= settleOffset) return { offset: 0, velocity: 0 }
    const nextVelocity = smoothFaceCenteringVelocity(currentVelocity, desiredVelocity, stepMs)
    const nextOffset = offset - nextVelocity * stepSeconds
    return offset * nextOffset <= 0
      ? { offset: 0, velocity: 0 }
      : { offset: nextOffset, velocity: nextVelocity }
  }

  for (let elapsedMs = 0; elapsedMs <= 15_000; elapsedMs += stepMs) {
    if (!yawOffset && !pitchOffset && !forwardOffset) return elapsedMs
    const yaw = advanceAxis(yawOffset, yawVelocity, getFaceCenteringVelocity(yawOffset, mode), yawSettleOffset)
    const pitch = advanceAxis(pitchOffset, pitchVelocity, getFaceCenteringVelocity(pitchOffset, mode), pitchSettleOffset)
    const forward = advanceAxis(forwardOffset, forwardVelocity, getFaceForwardVelocity(forwardOffset), forwardSettleOffset)
    yawOffset = yaw.offset
    yawVelocity = yaw.velocity
    pitchOffset = pitch.offset
    pitchVelocity = pitch.velocity
    forwardOffset = forward.offset
    forwardVelocity = forward.velocity
  }
  return Number.POSITIVE_INFINITY
}

export const getManualZoomForwardTarget = (currentForward: number, scale: number, surfaceDistance: number) =>
  surfaceDistance - (surfaceDistance - currentForward) / Math.max(Number.EPSILON, scale)

export const getFaceForwardTarget = (
  face: FaceBox,
  currentForward: number,
  surfaceDistance: number,
) => {
  const size = getFaceSize(face)
  if (!size) return currentForward
  if (isFaceSizeWithinDeadZone(size)) return currentForward
  const remainingDistance = Math.max(1, surfaceDistance - currentForward)
  return Math.min(
    surfaceDistance - remainingDistance * size / FACE_CENTER_TARGET_SIZE,
    FACE_CENTER_MAX_FORWARD,
  )
}

export const getFaceMovementHint = (error: FaceCenteringError): FaceMovementHint | undefined => {
  const labels: string[] = []
  if (error.yawOffset) labels.push(`${error.yaw > 0 ? "→" : "←"} ${Math.round(Math.abs(error.yaw))}°`)
  if (error.pitchOffset) labels.push(`${error.pitch > 0 ? "↑" : "↓"} ${Math.round(Math.abs(error.pitch))}°`)
  if (error.forwardOffset) labels.push(`${error.forward > 0 ? "nearer" : "farther"} ${Math.abs(error.forwardOffset).toFixed(1)}`)
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
    depthValue: error.forwardOffset ? Math.abs(error.forwardOffset).toFixed(1) : undefined,
  }
}

export interface AdvanceFaceMovementOptions {
  now: number
  delta: number
  state: FaceAutoCenterState
  view: CameraView
  projection: ProjectionMode
  camera: PerspectiveCamera
}

export interface FaceMovementStepResult {
  hint?: FaceMovementHint
  started: boolean
  stopped: boolean
  movementDurationMs: number
  settledBoundaryAxis?: FaceCenteringAxis
}

export const advanceFaceMovement = ({
  now,
  delta,
  state,
  view,
  projection,
  camera,
}: AdvanceFaceMovementOptions): FaceMovementStepResult => {
  const wasMoving = state.isMoving
  const frameDelta = clamp(delta || 1 / 60, 1 / 240, 0.05)
  const updateVelocity = (current: number, desired: number) =>
    smoothFaceCenteringVelocity(current, desired, frameDelta * 1000)
  const applyPlannedMovement = (plannedBoundaryAxis?: FaceCenteringAxis) => {
    const proposed = {
      yaw: view.yaw + state.yawVelocity * frameDelta,
      pitch: clamp(view.pitch + state.pitchVelocity * frameDelta, -85, 85),
      forward: Math.min(view.forward + state.forwardVelocity * frameDelta, FACE_CENTER_MAX_FORWARD),
    }
    const constrained = constrainFaceAutoCenterView(projection, camera, view, proposed)
    const blockedAxes = (["yaw", "pitch", "forward"] as const).filter(axis =>
      Math.abs(constrained[axis] - proposed[axis]) > 0.0001)
    const blockedAxis = blockedAxes[0]
    view.yaw = constrained.yaw
    view.pitch = constrained.pitch
    view.forward = constrained.forward
    if (blockedAxes.includes("yaw")) state.yawVelocity = 0
    if (blockedAxes.includes("pitch")) state.pitchVelocity = 0
    if (blockedAxes.includes("forward")) state.forwardVelocity = 0
    state.isMoving = state.yawVelocity !== 0 || state.pitchVelocity !== 0 || state.forwardVelocity !== 0
    return !state.isMoving ? (blockedAxis ?? plannedBoundaryAxis) : undefined
  }
  const getResult = (
    hint: FaceMovementHint | undefined,
    movementDurationMs: number,
    settledBoundaryAxis?: FaceCenteringAxis,
  ): FaceMovementStepResult => ({
    hint,
    started: !wasMoving && state.isMoving,
    stopped: wasMoving && !state.isMoving,
    movementDurationMs,
    settledBoundaryAxis,
  })

  const target = state.target
  const targetMaxAge = state.isMoving ? 4500 : 1100
  if (!target || now - target.lastSeenAt > targetMaxAge) {
    state.yawVelocity = updateVelocity(state.yawVelocity, 0)
    state.pitchVelocity = updateVelocity(state.pitchVelocity, 0)
    state.forwardVelocity = updateVelocity(state.forwardVelocity, 0)
    return getResult(undefined, 0, applyPlannedMovement())
  }

  const plan = getFaceCenteringPlan(target, camera, view, projection, state.isMoving)
  const x = plan.error.yawOffset
  const y = plan.error.pitchOffset
  const forward = plan.error.forwardOffset
  const hint = getFaceMovementHint(plan.error)

  if (!x && !y && !forward) state.offCenterSince = undefined
  else state.offCenterSince ??= now
  const desiredYawVelocity = getFaceCenteringVelocity(x, target.mode)
  const desiredPitchVelocity = getFaceCenteringVelocity(y, target.mode)
  const desiredForwardVelocity = getFaceForwardVelocity(forward)
  const movementDurationMs = !wasMoving
    ? estimateFaceCenteringDuration(plan.error, {
        yaw: state.yawVelocity,
        pitch: state.pitchVelocity,
        forward: state.forwardVelocity,
      }, target.mode)
    : 0
  state.yawVelocity = x ? updateVelocity(state.yawVelocity, desiredYawVelocity) : 0
  state.pitchVelocity = y ? updateVelocity(state.pitchVelocity, desiredPitchVelocity) : 0
  state.forwardVelocity = forward ? updateVelocity(state.forwardVelocity, desiredForwardVelocity) : 0
  return getResult(hint, movementDurationMs, applyPlannedMovement(plan.blockedAxis))
}
