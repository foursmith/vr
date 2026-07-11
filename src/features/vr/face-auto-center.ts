import type { PerspectiveCamera } from "three"
import type { NormalizedFace } from "../face-tracking/protocol"
import type { ProjectionPreset } from "./config"
import { MathUtils } from "three"

const VIEWPORT_TARGET_X = 0.5
const VIEWPORT_TARGET_Y = 1 / 3
const MIN_FACE_SCORE = 0.5
const TARGET_SMOOTHING_TIME_MS = 480

export type FaceBox = NormalizedFace & { lastSeenAt: number }
export type DetectionMode = "viewport" | "panorama"
interface FaceTarget { x: number, y: number, yaw?: number, pitch?: number, mode: DetectionMode, lastSeenAt: number }
interface FaceSelectionAnchor { x: number, y: number, weight: number, wrapX: boolean }
export interface PanoramaSample { center: { x: number, y: number }, startX: number, widthX: number, wraps: boolean }

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
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const shortestAngle = (degrees: number) => ((degrees + 540) % 360) - 180
const isHalfProjection = (preset: ProjectionPreset) =>
  preset === "sbs_180_eqr" || preset === "sbs_180_fe" || preset === "m_180_eqr" || preset === "m_180_fe"
const getProjectionYawSpan = (preset: ProjectionPreset) => (isHalfProjection(preset) ? 180 : 360)
export const getProjectionYawLimit = (preset: ProjectionPreset) => (isHalfProjection(preset) ? 86 : undefined)
const getViewportPitchOffset = (camera: PerspectiveCamera, y: number) => {
  const tanHalfVertical = Math.tan(MathUtils.degToRad(camera.fov) / 2) / camera.zoom
  return MathUtils.radToDeg(Math.atan((1 - y * 2) * tanHalfVertical))
}

export const getFaceCenter = (face: FaceBox) => ({
  x: face.x + face.width / 2,
  y: face.y + face.height / 2,
})

export const mapSampleFaceToPanorama = (face: FaceBox, sample: PanoramaSample): FaceBox => {
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
  preset: ProjectionPreset,
  camera: PerspectiveCamera,
) => {
  if (!face) return false
  const center = getFaceCenter(face)
  const yawLimit = getProjectionYawLimit(preset)
  const yaw = (VIEWPORT_TARGET_X - center.x) * getProjectionYawSpan(preset)
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
