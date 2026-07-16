import type { ProjectionMode } from "@foursmith/player-core"
import type { NormalizedFace } from "../face-tracking/protocol"
import type { FaceAutoCenterState, FaceBox, FaceWorldDirection, PanoramaSample } from "./face-auto-center"
import { MathUtils } from "three"

// Keep doc/PORTRAIT_CENTERING.md synchronized with scan geometry and sampling changes.

export const PANORAMA_COARSE_TILE_FOV = 100
const PANORAMA_FULL_SCAN_TILE_COUNT = 6
const PANORAMA_HALF_SCAN_TILE_COUNT = 5
export const PANORAMA_RELIABLE_FACE_SCORE = 0.7
export const PANORAMA_RELIABLE_CENTER_MARGIN = 0.18
export const PANORAMA_RELIABLE_BOX_MARGIN = 0.08
export const PANORAMA_REFINEMENT_FOV = 70

export interface PanoramaScanTile { yaw: number, pitch: number, fov: number }

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const shortestAngle = (degrees: number) => ((degrees + 540) % 360) - 180
const isHalfProjection = (projection: ProjectionMode) =>
  projection === "sbs_180_eqr" || projection === "sbs_180_fe" || projection === "m_180_eqr" || projection === "m_180_fe"
const isFullProjection = (projection: ProjectionMode) =>
  projection === "tb_360_eqr" || projection === "mono_360_eqr"
const getProjectionYawSpan = (projection: ProjectionMode) => (isHalfProjection(projection) ? 180 : 360)
const getProjectionYawLimit = (projection: ProjectionMode) => (isHalfProjection(projection) ? 86 : undefined)
const resizeCanvas = (canvas: HTMLCanvasElement, width: number, height: number) => {
  if (canvas.width !== width) canvas.width = width
  if (canvas.height !== height) canvas.height = height
}

export const getPanoramaScanTileCount = (projection: ProjectionMode) =>
  isFullProjection(projection)
    ? PANORAMA_FULL_SCAN_TILE_COUNT
    : isHalfProjection(projection) ? PANORAMA_HALF_SCAN_TILE_COUNT : 1

export const getPanoramaScanTile = (
  projection: ProjectionMode,
  tileIndex: number,
  originYaw: number,
  originPitch = 0,
): PanoramaScanTile => {
  if (isHalfProjection(projection)) {
    switch (tileIndex % PANORAMA_HALF_SCAN_TILE_COUNT) {
      case 0: return { yaw: 0, pitch: 0, fov: PANORAMA_COARSE_TILE_FOV }
      case 1: return { yaw: -60, pitch: 0, fov: PANORAMA_COARSE_TILE_FOV }
      case 2: return { yaw: 60, pitch: 0, fov: PANORAMA_COARSE_TILE_FOV }
      case 3: return { yaw: 0, pitch: 90, fov: PANORAMA_COARSE_TILE_FOV }
      default: return { yaw: 0, pitch: -90, fov: PANORAMA_COARSE_TILE_FOV }
    }
  }
  if (!isFullProjection(projection)) return { yaw: originYaw, pitch: originPitch, fov: PANORAMA_COARSE_TILE_FOV }
  const origin = shortestAngle(originYaw)
  switch (tileIndex % PANORAMA_FULL_SCAN_TILE_COUNT) {
    case 0: return { yaw: origin, pitch: 0, fov: PANORAMA_COARSE_TILE_FOV }
    case 1: return { yaw: shortestAngle(origin + 90), pitch: 0, fov: PANORAMA_COARSE_TILE_FOV }
    case 2: return { yaw: shortestAngle(origin + 180), pitch: 0, fov: PANORAMA_COARSE_TILE_FOV }
    case 3: return { yaw: shortestAngle(origin - 90), pitch: 0, fov: PANORAMA_COARSE_TILE_FOV }
    case 4: return { yaw: origin, pitch: 90, fov: PANORAMA_COARSE_TILE_FOV }
    default: return { yaw: origin, pitch: -90, fov: PANORAMA_COARSE_TILE_FOV }
  }
}

const sphericalDistance = (first: FaceWorldDirection, second: FaceWorldDirection) => {
  const firstPitch = MathUtils.degToRad(first.pitch)
  const secondPitch = MathUtils.degToRad(second.pitch)
  const yawDelta = MathUtils.degToRad(shortestAngle(first.yaw - second.yaw))
  return MathUtils.radToDeg(Math.acos(clamp(
    Math.sin(firstPitch) * Math.sin(secondPitch)
    + Math.cos(firstPitch) * Math.cos(secondPitch) * Math.cos(yawDelta),
    -1,
    1,
  )))
}

export const getPanoramaScanTiles = (
  projection: ProjectionMode,
  originYaw: number,
  originPitch = 0,
  predictedDirection?: FaceWorldDirection,
) => {
  const tiles = Array.from(
    { length: getPanoramaScanTileCount(projection) },
    (_, index) => ({ tile: getPanoramaScanTile(projection, index, originYaw, originPitch), index }),
  )
  if (!predictedDirection) return tiles.map(item => item.tile)
  return tiles
    .sort((first, second) => {
      const distance = sphericalDistance(first.tile, predictedDirection) - sphericalDistance(second.tile, predictedDirection)
      return Math.abs(distance) > 0.0001 ? distance : first.index - second.index
    })
    .map(item => item.tile)
}

export const isPanoramaCandidateReliable = (face: NormalizedFace | undefined) => {
  if (!face || face.score < PANORAMA_RELIABLE_FACE_SCORE) return false
  const centerX = face.x + face.width / 2
  const centerY = face.y + face.height / 2
  return centerX >= PANORAMA_RELIABLE_CENTER_MARGIN
    && centerX <= 1 - PANORAMA_RELIABLE_CENTER_MARGIN
    && centerY >= PANORAMA_RELIABLE_CENTER_MARGIN
    && centerY <= 1 - PANORAMA_RELIABLE_CENTER_MARGIN
    && face.x >= PANORAMA_RELIABLE_BOX_MARGIN
    && face.y >= PANORAMA_RELIABLE_BOX_MARGIN
    && face.x + face.width <= 1 - PANORAMA_RELIABLE_BOX_MARGIN
    && face.y + face.height <= 1 - PANORAMA_RELIABLE_BOX_MARGIN
}

export const getPanoramaRefinementTile = (
  projection: ProjectionMode,
  face: FaceBox,
): PanoramaScanTile => {
  const centerX = face.x + face.width / 2
  const centerY = face.y + face.height / 2
  const yawSpan = getProjectionYawSpan(projection)
  const yawLimit = getProjectionYawLimit(projection)
  const yaw = shortestAngle((0.5 - centerX) * yawSpan)
  return {
    yaw: yawLimit === undefined ? yaw : clamp(yaw, -yawLimit, yawLimit),
    pitch: clamp((0.5 - centerY) * 180, -85, 85),
    fov: PANORAMA_REFINEMENT_FOV,
  }
}

export const createPerspectivePanoramaSample = (
  projection: ProjectionMode,
  tile: PanoramaScanTile,
  aspect = 1,
): PanoramaSample => {
  const yawSpan = getProjectionYawSpan(projection)
  return {
    center: {
      x: yawSpan === 360 ? ((0.5 - tile.yaw / yawSpan) % 1 + 1) % 1 : clamp(0.5 - tile.yaw / yawSpan, 0, 1),
      y: clamp(0.5 - tile.pitch / 180, 0, 1),
    },
    startX: 0,
    widthX: 1,
    wraps: yawSpan === 360,
    perspective: { ...tile, aspect, yawSpan },
  }
}

export const getViewportInferenceSampleSize = (sourceWidth: number, sourceHeight: number, sampleWidth: number) => {
  if (!sourceWidth || !sourceHeight) return undefined
  const width = Math.max(160, Math.round(sampleWidth))
  return { width, height: Math.max(120, Math.round(width / (sourceWidth / sourceHeight))) }
}

export const drawViewportInferenceSample = (
  canvas: HTMLCanvasElement,
  context: CanvasRenderingContext2D,
  source: CanvasImageSource,
  sourceX: number,
  sourceY: number,
  sourceWidth: number,
  sourceHeight: number,
  sampleWidth: number,
) => {
  const size = getViewportInferenceSampleSize(sourceWidth, sourceHeight, sampleWidth)
  if (!size) return undefined
  resizeCanvas(canvas, size.width, size.height)
  context.drawImage(
    source,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    0,
    0,
    size.width,
    size.height,
  )
  return size
}

export const drawSampleBoxes = (
  state: FaceAutoCenterState,
  canvas: HTMLCanvasElement,
  context: CanvasRenderingContext2D,
  time: number,
  label: string,
) => {
  const freshFaces = state.faces.filter(face => time - face.lastSeenAt < 1200)
  state.faces = freshFaces
  context.save()
  context.fillStyle = "rgba(7, 16, 18, 0.82)"
  context.fillRect(0, 0, Math.min(110, canvas.width), 22)
  context.fillStyle = "#8ddde3"
  context.font = "600 11px monospace"
  context.fillText(label, 8, 15)
  context.restore()
  freshFaces.forEach((face) => {
    const x = face.x * canvas.width
    const y = face.y * canvas.height
    const width = face.width * canvas.width
    const height = face.height * canvas.height
    context.save()
    context.strokeStyle = "#62cfd8"
    context.lineWidth = Math.max(2, canvas.width / 420)
    context.shadowColor = "rgba(98, 207, 216, 0.46)"
    context.shadowBlur = canvas.width / 80
    context.strokeRect(x, y, width, height)
    context.shadowBlur = 0
    const label = `${Math.round(face.score * 100)}%`
    const labelY = Math.max(0, y - 18)
    const labelWidth = Math.min(canvas.width - x, Math.max(42, label.length * 7 + 10))
    const sizeLabel = Math.sqrt(Math.max(0, face.width * face.height)).toFixed(2)
    const sizeLabelWidth = Math.max(42, sizeLabel.length * 7 + 10)
    const sizeLabelRight = Math.min(canvas.width, x + width)
    const sizeLabelX = Math.max(0, sizeLabelRight - sizeLabelWidth)
    context.fillStyle = "rgba(7, 34, 37, 0.92)"
    context.fillRect(x, labelY, labelWidth, 18)
    context.fillRect(sizeLabelX, labelY, sizeLabelWidth, 18)
    context.fillStyle = "#b7edf0"
    context.font = "600 11px monospace"
    context.fillText(label, x + 5, Math.max(12, y - 5))
    context.textAlign = "right"
    context.fillText(sizeLabel, sizeLabelRight - 5, Math.max(12, y - 5))
    context.restore()
  })
}

export const drawSampleStatus = (
  canvas: HTMLCanvasElement,
  context: CanvasRenderingContext2D,
  label: string,
) => {
  if (canvas.width <= 1 || canvas.height <= 1) resizeCanvas(canvas, 320, 180)
  context.save()
  const labelWidth = Math.min(160, canvas.width - 16)
  const labelHeight = 28
  const labelX = (canvas.width - labelWidth) / 2
  const labelY = (canvas.height - labelHeight) / 2
  context.fillStyle = "rgba(7, 16, 18, 0.84)"
  context.fillRect(labelX, labelY, labelWidth, labelHeight)
  context.fillStyle = "#b7edf0"
  context.font = "600 12px monospace"
  context.textAlign = "center"
  context.textBaseline = "middle"
  context.fillText(label, canvas.width / 2, canvas.height / 2)
  context.restore()
}
