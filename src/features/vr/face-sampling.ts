import type { CameraView, ProjectionMode } from "@foursmith/player-core"
import type { PerspectiveCamera } from "three"
import type { FaceAutoCenterState, PanoramaSample } from "./face-auto-center"
import { MathUtils } from "three"

// Keep doc/FACE_SCANNING.md synchronized with scan geometry and sampling changes.

const VIEWPORT_TARGET_X = 0.5
const VIEWPORT_TARGET_Y = 1 / 3
const PANORAMA_SEARCH_DEGREES = 140
const PANORAMA_SAMPLE_MAX_HEIGHT = 384
const PANORAMA_HORIZONTAL_TILE_FOV = 130
const PANORAMA_CAP_TILE_FOV = 110
const PANORAMA_SCAN_TILE_COUNT = 5
const PANORAMA_RING_PITCH_LIMIT = 45

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
  context.fillStyle = "rgba(0, 0, 0, 0.58)"
  context.fillRect(0, 0, Math.min(110, canvas.width), 22)
  context.fillStyle = "#fff"
  context.font = "bold 12px monospace"
  context.fillText(label, 8, 15)
  context.restore()
  freshFaces.forEach((face) => {
    const x = face.x * canvas.width
    const y = face.y * canvas.height
    const width = face.width * canvas.width
    const height = face.height * canvas.height
    context.save()
    context.strokeStyle = "#38ff8b"
    context.lineWidth = Math.max(2, canvas.width / 420)
    context.shadowColor = "rgba(56, 255, 139, 0.6)"
    context.shadowBlur = canvas.width / 80
    context.strokeRect(x, y, width, height)
    context.shadowBlur = 0
    context.fillStyle = "rgba(10, 132, 255, 0.9)"
    context.fillRect(x, Math.max(0, y - 18), 42, 18)
    context.fillStyle = "#fff"
    context.font = "bold 12px monospace"
    context.fillText(`${Math.round(face.score * 100)}%`, x + 5, Math.max(12, y - 5))
    context.restore()
  })
}
