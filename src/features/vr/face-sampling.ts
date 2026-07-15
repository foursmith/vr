import type { CameraView, ProjectionMode } from "@foursmith/player-core"
import type { PerspectiveCamera } from "three"
import type { NormalizedFace } from "../face-tracking/protocol"
import type { FaceAutoCenterState, FaceBox, FaceWorldDirection, PanoramaSample } from "./face-auto-center"
import { MathUtils } from "three"

// Keep doc/PORTRAIT_CENTERING.md synchronized with scan geometry and sampling changes.

const VIEWPORT_TARGET_X = 0.5
const VIEWPORT_TARGET_Y = 1 / 3
const PANORAMA_SEARCH_DEGREES = 140
const PANORAMA_SAMPLE_MAX_HEIGHT = 384
const PANORAMA_HORIZONTAL_TILE_FOV = 130
const PANORAMA_CAP_TILE_FOV = 110
const PANORAMA_SCAN_TILE_COUNT = 5
const PANORAMA_RING_PITCH_LIMIT = 45
export const PANORAMA_RELIABLE_FACE_SCORE = 0.7
export const PANORAMA_RELIABLE_CENTER_MARGIN = 0.18
export const PANORAMA_RELIABLE_BOX_MARGIN = 0.08
export const PANORAMA_REFINEMENT_FOV = 70

export interface PanoramaScanTile { yaw: number, pitch: number, fov: number }

interface SourceCrop { x: number, y: number, width: number, height: number }

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const shortestAngle = (degrees: number) => ((degrees + 540) % 360) - 180
const isHalfProjection = (projection: ProjectionMode) =>
  projection === "sbs_180_eqr" || projection === "sbs_180_fe" || projection === "m_180_eqr" || projection === "m_180_fe"
const isFullProjection = (projection: ProjectionMode) =>
  projection === "tb_360_eqr" || projection === "mono_360_eqr"
const getProjectionYawSpan = (projection: ProjectionMode) => (isHalfProjection(projection) ? 180 : 360)
const getProjectionYawLimit = (projection: ProjectionMode) => (isHalfProjection(projection) ? 86 : undefined)
const getViewportPitchOffset = (camera: PerspectiveCamera, y: number) => {
  const tanHalfVertical = Math.tan(MathUtils.degToRad(camera.fov) / 2) / camera.zoom
  return MathUtils.radToDeg(Math.atan((1 - y * 2) * tanHalfVertical))
}

const resizeCanvas = (canvas: HTMLCanvasElement, width: number, height: number) => {
  if (canvas.width !== width) canvas.width = width
  if (canvas.height !== height) canvas.height = height
}

export const getPanoramaScanTileCount = (projection: ProjectionMode) =>
  isHalfProjection(projection) || isFullProjection(projection) ? PANORAMA_SCAN_TILE_COUNT : 1

export const getPanoramaScanTile = (
  projection: ProjectionMode,
  tileIndex: number,
  originYaw: number,
  originPitch = 0,
): PanoramaScanTile => {
  const ringPitch = clamp(originPitch, -PANORAMA_RING_PITCH_LIMIT, PANORAMA_RING_PITCH_LIMIT)
  if (isHalfProjection(projection)) {
    const origin = clamp(shortestAngle(originYaw), -86, 86)
    switch (tileIndex % PANORAMA_SCAN_TILE_COUNT) {
      case 0: return { yaw: origin, pitch: ringPitch, fov: PANORAMA_HORIZONTAL_TILE_FOV }
      case 1: return { yaw: -60, pitch: ringPitch, fov: PANORAMA_HORIZONTAL_TILE_FOV }
      case 2: return { yaw: 60, pitch: ringPitch, fov: PANORAMA_HORIZONTAL_TILE_FOV }
      case 3: return { yaw: origin, pitch: 70, fov: PANORAMA_CAP_TILE_FOV }
      default: return { yaw: origin, pitch: -70, fov: PANORAMA_CAP_TILE_FOV }
    }
  }
  if (!isFullProjection(projection)) return { yaw: originYaw, pitch: originPitch, fov: PANORAMA_HORIZONTAL_TILE_FOV }
  switch (tileIndex % PANORAMA_SCAN_TILE_COUNT) {
    case 0: return { yaw: shortestAngle(originYaw), pitch: ringPitch, fov: PANORAMA_HORIZONTAL_TILE_FOV }
    case 1: return { yaw: shortestAngle(originYaw + 120), pitch: ringPitch, fov: PANORAMA_HORIZONTAL_TILE_FOV }
    case 2: return { yaw: shortestAngle(originYaw - 120), pitch: ringPitch, fov: PANORAMA_HORIZONTAL_TILE_FOV }
    case 3: return { yaw: shortestAngle(originYaw), pitch: 70, fov: PANORAMA_CAP_TILE_FOV }
    default: return { yaw: shortestAngle(originYaw), pitch: -70, fov: PANORAMA_CAP_TILE_FOV }
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

const getSourceCrop = (video: HTMLVideoElement, projection: ProjectionMode): SourceCrop => {
  switch (projection) {
    case "sbs_180_eqr":
    case "sbs_180_fe":
      return { x: 0, y: 0, width: video.videoWidth / 2, height: video.videoHeight }
    case "tb_360_eqr":
      return { x: 0, y: 0, width: video.videoWidth, height: video.videoHeight / 2 }
    default:
      return { x: 0, y: 0, width: video.videoWidth, height: video.videoHeight }
  }
}

const drawPanoramaSample = (
  context: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  crop: SourceCrop,
  width: number,
  height: number,
  view: CameraView,
  projection: ProjectionMode,
  camera: PerspectiveCamera,
): PanoramaSample => {
  const yawSpan = getProjectionYawSpan(projection)
  const yawLimit = getProjectionYawLimit(projection)
  const yaw = yawLimit === undefined ? shortestAngle(view.yaw) : clamp(shortestAngle(view.yaw), -yawLimit, yawLimit)
  const center = {
    x: yawSpan === 360 ? ((0.5 - yaw / yawSpan) % 1 + 1) % 1 : clamp(VIEWPORT_TARGET_X - yaw / yawSpan, 0, 1),
    y: clamp(0.5 - (clamp(view.pitch, -75, 75) + getViewportPitchOffset(camera, VIEWPORT_TARGET_Y)) / 180, 0, 1),
  }
  const wraps = yawLimit === undefined
  const widthX = Math.min(1, PANORAMA_SEARCH_DEGREES / yawSpan)
  const startX = wraps ? ((center.x - widthX / 2) % 1 + 1) % 1 : clamp(center.x - widthX / 2, 0, 1 - widthX)
  const drawSlice = (sourceStartX: number, sourceWidthX: number, destStartX: number, destWidthX: number) => {
    if (sourceWidthX <= 0 || destWidthX <= 0) return
    context.drawImage(
      video,
      crop.x + sourceStartX * crop.width,
      crop.y,
      sourceWidthX * crop.width,
      crop.height,
      destStartX * width,
      0,
      destWidthX * width,
      height,
    )
  }
  if (!wraps || startX + widthX <= 1) {
    drawSlice(startX, widthX, 0, 1)
  } else {
    const firstWidthX = 1 - startX
    const firstDestWidthX = firstWidthX / widthX
    drawSlice(startX, firstWidthX, 0, firstDestWidthX)
    drawSlice(0, widthX - firstWidthX, firstDestWidthX, 1 - firstDestWidthX)
  }
  return { center, startX, widthX, wraps }
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

export const drawPanoramaInferenceSample = (
  canvas: HTMLCanvasElement,
  context: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  sampleWidth: number,
  projection: ProjectionMode,
  view: CameraView,
  camera: PerspectiveCamera,
  tileIndex?: number,
  originYaw = view.yaw,
) => {
  if (!video.videoWidth || !video.videoHeight || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return undefined
  const crop = getSourceCrop(video, projection)
  const yawSpan = getProjectionYawSpan(projection)
  const aspect = (crop.width * (Math.min(yawSpan, PANORAMA_SEARCH_DEGREES) / yawSpan)) / crop.height
  let width = Math.max(160, Math.round(sampleWidth))
  let height = Math.max(120, Math.round(width / Math.max(aspect, 0.25)))
  if (height > PANORAMA_SAMPLE_MAX_HEIGHT) {
    const scale = PANORAMA_SAMPLE_MAX_HEIGHT / height
    width = Math.max(1, Math.round(width * scale))
    height = PANORAMA_SAMPLE_MAX_HEIGHT
  }
  resizeCanvas(canvas, width, height)
  const tileView = {
    ...view,
    yaw: tileIndex === undefined ? view.yaw : getPanoramaScanTile(projection, tileIndex, originYaw, view.pitch).yaw,
  }
  return drawPanoramaSample(context, video, crop, width, height, tileView, projection, camera)
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
    const poseLabel = face.pose
      ? ` Y${Math.round(face.pose.yaw)}° P${Math.round(face.pose.pitch)}° R${Math.round(face.pose.roll)}°`
      : ""
    const label = `${Math.round(face.score * 100)}%${poseLabel}`
    const labelY = Math.max(0, y - 18)
    const labelWidth = Math.min(canvas.width - x, Math.max(42, label.length * 7 + 10))
    context.fillStyle = "rgba(7, 34, 37, 0.92)"
    context.fillRect(x, labelY, labelWidth, 18)
    context.fillStyle = "#b7edf0"
    context.font = "600 11px monospace"
    context.fillText(label, x + 5, Math.max(12, y - 5))
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
