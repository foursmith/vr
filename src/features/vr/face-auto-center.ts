import type { ProjectionMode } from "@foursmith/player-core"
import type { PerspectiveCamera } from "three"
import type { NormalizedFace } from "../face-tracking/protocol"
import { Euler, MathUtils, Vector3 } from "three"

const VIEWPORT_TARGET_X = 0.5
const VIEWPORT_TARGET_Y = 1 / 3
export const FACE_CENTER_VIEWPORT_ACTIVATION_THRESHOLD = 0.08
export const FACE_CENTER_VIEWPORT_SETTLE_THRESHOLD = 0.05
export const FACE_CENTER_PANORAMA_ACTIVATION_DEGREES = 10
export const FACE_CENTER_PANORAMA_SETTLE_DEGREES = 7
const MIN_FACE_SCORE = 0.5
const TARGET_SMOOTHING_TIME_MS = 480

export type FaceBox = NormalizedFace & { lastSeenAt: number }
export type DetectionMode = "viewport" | "panorama"
export interface FaceTarget { x: number, y: number, yaw?: number, pitch?: number, mode: DetectionMode, lastSeenAt: number }
export interface FaceCenteringError {
  yaw: number
  pitch: number
  yawOffset: number
  pitchOffset: number
  needsMovement: boolean
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
}

export interface FaceAutoCenterState {
  faces: FaceBox[]
  selectedFace?: FaceBox & { mode: DetectionMode }
  detectionMode: DetectionMode
  nextDetectionAt: number
  lastDetectionAt: number
  recoveryMode?: DetectionMode
  consecutiveMisses: number
  isMoving: boolean
  offCenterSince?: number
  target?: FaceTarget
  yawVelocity: number
  pitchVelocity: number
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

export const getFaceCenteringError = (
  target: FaceTarget,
  camera: PerspectiveCamera,
  view: { yaw: number, pitch: number },
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
  const yawOffset = Math.sign(yaw) * Math.max(0, Math.abs(yaw) - yawDeadZone)
  const pitchOffset = Math.sign(pitch) * Math.max(0, Math.abs(pitch) - pitchDeadZone)
  return {
    yaw,
    pitch,
    yawOffset,
    pitchOffset,
    needsMovement: yawOffset !== 0 || pitchOffset !== 0,
  }
}

export const getFaceCenter = (face: FaceBox) => ({
  x: face.x + face.width / 2,
  y: face.y + face.height / 2,
})

export const updateFaceMotion = (state: FaceAutoCenterState, face: FaceBox, time: number) => {
  const center = getFaceCenter(face)
  const size = Math.sqrt(Math.max(0, face.width * face.height))
  const previous = state.motion
  const elapsedMs = previous ? time - previous.lastSeenAt : 0
  if (!previous || elapsedMs <= 0 || elapsedMs > 1500) {
    state.motion = { centerX: center.x, centerY: center.y, size, speed: 0, recedingSpeed: 0, lastSeenAt: time }
    return state.motion
  }

  const elapsedSeconds = elapsedMs / 1000
  const measuredSpeed = clamp(Math.hypot(center.x - previous.centerX, center.y - previous.centerY) / elapsedSeconds, 0, 4)
  const measuredRecedingSpeed = clamp((previous.size - size) / elapsedSeconds, -2, 2)
  const blend = 1 - Math.exp(-elapsedMs / 350)
  state.motion = {
    centerX: center.x,
    centerY: center.y,
    size,
    speed: previous.speed + (measuredSpeed - previous.speed) * blend,
    recedingSpeed: previous.recedingSpeed + (measuredRecedingSpeed - previous.recedingSpeed) * blend,
    lastSeenAt: time,
  }
  return state.motion
}

export const pauseFaceAutoCenter = (state: FaceAutoCenterState) => {
  state.manuallyPaused = true
  state.faces = []
  state.selectedFace = undefined
  state.target = undefined
  state.motion = undefined
  state.recoveryMode = undefined
  state.consecutiveMisses = 0
  state.offCenterSince = undefined
  state.yawVelocity = 0
  state.pitchVelocity = 0
  state.isMoving = false
  state.nextDetectionAt = Number.POSITIVE_INFINITY
}

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
    mode: nextTarget.mode,
    lastSeenAt: nextTarget.lastSeenAt,
  }
}

export const setViewportTarget = (
  state: FaceAutoCenterState,
  face: FaceBox | undefined,
  time: number,
  center = face ? getFaceCenter(face) : undefined,
) => {
  if (!face || !center) return false
  smoothTarget(state, { x: center.x - VIEWPORT_TARGET_X, y: center.y - VIEWPORT_TARGET_Y, mode: "viewport", lastSeenAt: time })
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
