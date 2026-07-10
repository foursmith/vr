import {
  BackSide,
  BufferAttribute,
  Color,
  FrontSide,
  Group,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  SphereGeometry,
  SRGBColorSpace,
  VideoTexture,
  WebGLRenderer,
  type BufferGeometry,
  type Side,
  type Texture,
} from 'three'
import { getFaceTrackerClient, preloadFaceAutoCenterResources } from './face-tracker-client'
import type { FaceInferenceMode, FaceInferenceResult, NormalizedFace } from './face-tracker-protocol'

export { preloadFaceAutoCenterResources } from './face-tracker-client'

export type MutableRefObject<T> = { current: T }

export const PRESETS = [
  { label: 'SBS 180 EQR', component: 'sbs_180_eqr' },
  { label: 'SBS 180 FE', component: 'sbs_180_fe' },
  { label: 'TB 360 EQR', component: 'tb_360_eqr' },
  { label: 'Flat 2D', component: 'flat_2d' },
  { label: 'Mono 180 EQR', component: 'm_180_eqr' },
  { label: 'Mono 360 EQR', component: 'mono_360_eqr' },
  { label: 'Mono 180 FE', component: 'm_180_fe' },
] as const

export const QUALITY_OPTIONS = [
  { label: 'Performance', component: 'performance', pixelRatio: 1 },
  { label: 'Balanced', component: 'balanced', pixelRatio: 1.5 },
  { label: 'Sharp', component: 'sharp', pixelRatio: 2 },
  { label: 'Ultra', component: 'ultra', pixelRatio: 2.5 },
] as const

export const DEFAULT_FOV = 80
export const DEFAULT_ZOOM = 1

const MIN_ZOOM = 0.8
const MAX_ZOOM = 2.4
const WHEEL_ZOOM_SPEED = 0.0016
const VIEWPORT_TARGET_X = 0.5
const VIEWPORT_TARGET_Y = 1 / 3
const VIEWPORT_DEAD_ZONE_X = 0.04
const VIEWPORT_DEAD_ZONE_Y = 0.04
const MIN_FACE_SCORE = 0.5
const TARGET_SMOOTHING_TIME_MS = 480
const PANORAMA_DIRECTION_ANCHOR_WEIGHT = 1.35
const PANORAMA_SEARCH_DEGREES = 140
const FACE_TRACK_ACTIVE_INTERVAL_MS = 120
const FACE_TRACK_STABLE_INTERVAL_MS = 240
const FACE_RECOVERY_INTERVAL_MS = 80
const FACE_INFERENCE_HEADROOM = 1.15
const FACE_INFERENCE_MAX_PERIOD_MS = 360
const FACE_TARGET_GRACE_MS = 900
const VIEWPORT_SAMPLE_WIDTH = 320
const PANORAMA_SAMPLE_WIDTH = 320
const PANORAMA_SAMPLE_MAX_HEIGHT = 384
const MAX_SPLIT_SCREEN_PANELS = 3
const MIN_SPLIT_SCREEN_ASPECT = 9 / 16
const FACE_CENTER_RESPONSE = 0.65
const FACE_CENTER_MAX_SPEED = 5.5
const FACE_CENTER_VELOCITY_SMOOTHING_MS = 260
const FACE_CENTER_STOP_SPEED = 0.025

type ProjectionPreset = (typeof PRESETS)[number]['component']
type ProjectionQuality = (typeof QUALITY_OPTIONS)[number]['component']
type SourceCrop = { x: number; y: number; width: number; height: number }
type FaceBox = NormalizedFace & { lastSeenAt: number }
type DetectionMode = 'viewport' | 'panorama'
type FaceTarget = { x: number; y: number; yaw?: number; pitch?: number; mode: DetectionMode; lastSeenAt: number }
type FaceSelectionAnchor = { x: number; y: number; weight: number; wrapX: boolean }
type PanoramaSample = { center: { x: number; y: number }; startX: number; widthX: number; wraps: boolean }
type RenderViewport = { x: number; y: number; width: number; height: number }

export type CameraView = {
  yaw: number
  pitch: number
  zoom: number
  pausedUntil: number
}

type OverlayState = {
  hint?: { side: 'left' | 'right'; top: number; text: string }
}

type FaceAutoCenterState = {
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

const QUALITY_SEGMENTS: Record<ProjectionQuality, { eqrHalfWidth: number; eqrFullWidth: number; eqrHeight: number; fisheye: number }> = {
  performance: { eqrHalfWidth: 48, eqrFullWidth: 64, eqrHeight: 32, fisheye: 48 },
  balanced: { eqrHalfWidth: 72, eqrFullWidth: 96, eqrHeight: 48, fisheye: 72 },
  sharp: { eqrHalfWidth: 96, eqrFullWidth: 128, eqrHeight: 64, fisheye: 96 },
  ultra: { eqrHalfWidth: 128, eqrFullWidth: 192, eqrHeight: 96, fisheye: 128 },
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const shortestAngle = (degrees: number) => ((degrees + 540) % 360) - 180
const getViewportTanHalfVertical = (camera: PerspectiveCamera) =>
  Math.tan(MathUtils.degToRad(camera.fov) / 2) / camera.zoom
const getViewportYawOffset = (camera: PerspectiveCamera, x: number) =>
  MathUtils.radToDeg(Math.atan((1 - x * 2) * getViewportTanHalfVertical(camera) * camera.aspect))
const getViewportPitchOffset = (camera: PerspectiveCamera, y: number) =>
  MathUtils.radToDeg(Math.atan((1 - y * 2) * getViewportTanHalfVertical(camera)))

const resizeCanvas = (canvas: HTMLCanvasElement, width: number, height: number) => {
  if (canvas.width !== width) canvas.width = width
  if (canvas.height !== height) canvas.height = height
}

const getRenderViewports = (width: number, height: number, splitScreen: boolean): RenderViewport[] => {
  if (!splitScreen || width <= height) return [{ x: 0, y: 0, width, height }]

  const panelCount = Math.min(MAX_SPLIT_SCREEN_PANELS, Math.max(1, Math.floor(width / (height * MIN_SPLIT_SCREEN_ASPECT))))
  const panelWidth = width / panelCount

  return Array.from({ length: panelCount }, (_, index) => ({
    x: panelWidth * index,
    y: 0,
    width: panelWidth,
    height,
  }))
}

const getUv = (geometry: BufferGeometry) => geometry.attributes.uv as BufferAttribute

const setUvCrop = (geometry: BufferGeometry, repeat: { x: number; y: number }, offset: { x: number; y: number }) => {
  const uv = getUv(geometry)
  for (let i = 0; i < uv.count; i += 1) {
    uv.setXY(i, uv.getX(i) * repeat.x + offset.x, uv.getY(i) * repeat.y + offset.y)
  }
  uv.needsUpdate = true
}

const createFisheyeGeometry = (stereo: boolean, segments: number) => {
  const geometry = new SphereGeometry(100, segments, segments)
  const fov = Math.PI

  geometry.rotateX(-Math.PI / 2)
  geometry.rotateY(Math.PI)

  const uv = getUv(geometry)
  for (let i = 0; i < uv.count; i += 1) {
    const theta = 2 * Math.PI * uv.getX(i)
    const phi = Math.PI * uv.getY(i)
    const radius = phi / fov
    let u = 0.5 + radius * Math.cos(theta)
    const v = 0.5 + radius * Math.sin(theta)

    if (stereo) u *= 0.5
    uv.setXY(i, u, v)
  }
  uv.needsUpdate = true
  return geometry
}

const createVideoMaterial = (texture: Texture, side: Side) =>
  new MeshBasicMaterial({
    map: texture,
    side,
    toneMapped: false,
  })

const disposeObject = (object: Object3D) => {
  object.traverse((child) => {
    const mesh = child as Mesh
    mesh.geometry?.dispose()
    const material = mesh.material
    if (Array.isArray(material)) {
      material.forEach((item) => item.dispose())
    } else {
      material?.dispose()
    }
  })
}

const createMask = () => {
  const mask = new Mesh(
    new SphereGeometry(99, 32, 8, 0, Math.PI * 2, 0, Math.PI / 2),
    new MeshBasicMaterial({ color: '#14120f', side: BackSide }),
  )
  mask.rotation.x = Math.PI / 2
  return mask
}

const createProjectionGroup = (video: HTMLVideoElement, texture: VideoTexture, preset: ProjectionPreset, quality: ProjectionQuality) => {
  const group = new Group()
  const segments = QUALITY_SEGMENTS[quality]

  switch (preset) {
    case 'sbs_180_eqr': {
      const geometry = new SphereGeometry(100, segments.eqrHalfWidth, segments.eqrHeight, Math.PI, Math.PI, 0, Math.PI)
      setUvCrop(geometry, { x: -0.5, y: 1 }, { x: 0.5, y: 0 })
      group.add(new Mesh(geometry, createVideoMaterial(texture, BackSide)))
      break
    }
    case 'sbs_180_fe':
      group.add(new Mesh(createFisheyeGeometry(true, segments.fisheye), createVideoMaterial(texture, BackSide)))
      group.add(createMask())
      break
    case 'tb_360_eqr': {
      const geometry = new SphereGeometry(100, segments.eqrFullWidth, segments.eqrHeight, 0, Math.PI * 2, 0, Math.PI)
      setUvCrop(geometry, { x: 1, y: 0.5 }, { x: 0, y: 0.5 })
      const mesh = new Mesh(geometry, createVideoMaterial(texture, BackSide))
      mesh.scale.set(-1, 1, 1)
      mesh.rotation.y = -Math.PI / 2
      group.add(mesh)
      break
    }
    case 'flat_2d': {
      const height = 60
      const aspect = video.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : 1.77
      group.add(
        new Mesh(
          new SphereGeometry(120, 32, 16),
          new MeshBasicMaterial({ color: '#14120f', side: BackSide }),
        ),
      )
      const screen = new Mesh(new PlaneGeometry(height * aspect, height), createVideoMaterial(texture, FrontSide))
      screen.position.set(0, 10, -65)
      group.add(screen)
      break
    }
    case 'm_180_eqr': {
      const mesh = new Mesh(
        new SphereGeometry(100, segments.eqrHalfWidth, segments.eqrHeight, Math.PI, Math.PI, 0, Math.PI),
        createVideoMaterial(texture, BackSide),
      )
      mesh.scale.set(-1, 1, 1)
      group.add(mesh)
      break
    }
    case 'mono_360_eqr': {
      const mesh = new Mesh(
        new SphereGeometry(100, segments.eqrFullWidth, segments.eqrHeight, 0, Math.PI * 2, 0, Math.PI),
        createVideoMaterial(texture, BackSide),
      )
      mesh.scale.set(-1, 1, 1)
      mesh.rotation.y = -Math.PI / 2
      group.add(mesh)
      break
    }
    case 'm_180_fe':
      group.add(new Mesh(createFisheyeGeometry(false, segments.fisheye), createVideoMaterial(texture, BackSide)))
      group.add(createMask())
      break
  }

  return group
}

const isHalfProjection = (preset: ProjectionPreset) =>
  preset === 'sbs_180_eqr' || preset === 'sbs_180_fe' || preset === 'm_180_eqr' || preset === 'm_180_fe'

const getProjectionYawSpan = (preset: ProjectionPreset) => (isHalfProjection(preset) ? 180 : 360)
const getProjectionYawLimit = (preset: ProjectionPreset) => (isHalfProjection(preset) ? 86 : undefined)

const getSourceCrop = (video: HTMLVideoElement, preset: ProjectionPreset): SourceCrop => {
  switch (preset) {
    case 'sbs_180_eqr':
    case 'sbs_180_fe':
      return { x: 0, y: 0, width: video.videoWidth / 2, height: video.videoHeight }
    case 'tb_360_eqr':
      return { x: 0, y: 0, width: video.videoWidth, height: video.videoHeight / 2 }
    default:
      return { x: 0, y: 0, width: video.videoWidth, height: video.videoHeight }
  }
}

const getPanoramaCenterForView = (
  view: CameraView,
  projectionPreset: ProjectionPreset,
  camera: PerspectiveCamera,
) => {
  const yawSpan = getProjectionYawSpan(projectionPreset)
  const yawLimit = getProjectionYawLimit(projectionPreset)
  const yaw = yawLimit === undefined ? shortestAngle(view.yaw) : clamp(shortestAngle(view.yaw), -yawLimit, yawLimit)
  const pitch = clamp(view.pitch, -75, 75)
  const targetYOffset = getViewportPitchOffset(camera, VIEWPORT_TARGET_Y)

  return {
    x: yawSpan === 360 ? ((0.5 - yaw / yawSpan) % 1 + 1) % 1 : clamp(VIEWPORT_TARGET_X - yaw / yawSpan, 0, 1),
    y: clamp(0.5 - (pitch + targetYOffset) / 180, 0, 1),
  }
}

const drawPanoramaSample = (
  context: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  crop: SourceCrop,
  width: number,
  height: number,
  view: CameraView,
  preset: ProjectionPreset,
  camera: PerspectiveCamera,
): PanoramaSample => {
  const center = getPanoramaCenterForView(view, preset, camera)
  const wraps = getProjectionYawLimit(preset) === undefined
  const yawSpan = getProjectionYawSpan(preset)
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

const mapSampleFaceToPanorama = (face: FaceBox, sample: PanoramaSample): FaceBox => {
  const center = getFaceCenter(face)
  const rawCenterX = sample.startX + center.x * sample.widthX
  const panoramaCenterX = sample.wraps ? ((rawCenterX % 1) + 1) % 1 : clamp(rawCenterX, 0, 1)
  const width = face.width * sample.widthX
  return {
    ...face,
    // Keep the center normalized at the 360-degree seam. Wrapping the box's
    // left edge would put its computed center above 1 and destabilize yaw.
    x: sample.wraps ? panoramaCenterX - width / 2 : clamp(panoramaCenterX - width / 2, 0, 1 - width),
    width,
  }
}

const getFaceCenter = (face: FaceBox) => ({
  x: face.x + face.width / 2,
  y: face.y + face.height / 2,
})

const getFaceDistance = (face: FaceBox, previous: FaceBox, wrapX: boolean) => {
  const currentCenter = getFaceCenter(face)
  const previousCenter = getFaceCenter(previous)
  const rawX = Math.abs(currentCenter.x - previousCenter.x)
  const x = wrapX ? Math.min(rawX, 1 - rawX) : rawX
  const y = Math.abs(currentCenter.y - previousCenter.y)
  return Math.hypot(x, y)
}

const getAnchorDistance = (face: FaceBox, anchor: FaceSelectionAnchor) => {
  const center = getFaceCenter(face)
  const rawX = Math.abs(center.x - anchor.x)
  const x = anchor.wrapX ? Math.min(rawX, 1 - rawX) : rawX
  const y = Math.abs(center.y - anchor.y)
  return Math.hypot(x, y)
}

const selectStableFace = (
  state: FaceAutoCenterState,
  faces: FaceBox[],
  mode: DetectionMode,
  time: number,
  anchor?: FaceSelectionAnchor,
) => {
  const candidates = faces.filter((face) => face.score >= MIN_FACE_SCORE)
  if (!candidates.length) return undefined

  const previous = state.selectedFace && time - state.selectedFace.lastSeenAt < 2400 ? state.selectedFace : undefined
  const wrapX = mode === 'panorama'
  return candidates
    .map((face) => {
      const area = face.width * face.height
      const base = face.score * 1.2 + area * 2.4
      const continuity =
        previous && previous.mode === mode ? Math.max(0, 1 - getFaceDistance(face, previous, wrapX) / 0.32) * 1.6 : 0
      const directionContinuity = anchor ? Math.max(0, 1 - getAnchorDistance(face, anchor) / 0.42) * anchor.weight : 0
      return { face, score: base + continuity + directionContinuity }
    })
    .sort((a, b) => b.score - a.score)[0]?.face
}

const applyDetections = (
  state: FaceAutoCenterState,
  faces: NormalizedFace[],
  time: number,
  mode: DetectionMode,
  anchor?: FaceSelectionAnchor,
  transformFace: (face: FaceBox) => FaceBox = (face) => face,
) => {
  state.lastDetectionAt = time
  state.faces = faces.map((face) => ({ ...face, lastSeenAt: time }))

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

  const elapsed = Math.max(0, nextTarget.lastSeenAt - previous.lastSeenAt)
  const smoothing = 1 - Math.exp(-elapsed / TARGET_SMOOTHING_TIME_MS)
  state.target = {
    x: previous.x + (nextTarget.x - previous.x) * smoothing,
    y: previous.y + (nextTarget.y - previous.y) * smoothing,
    yaw:
      previous.yaw === undefined || nextTarget.yaw === undefined
        ? nextTarget.yaw
        : previous.yaw + shortestAngle(nextTarget.yaw - previous.yaw) * smoothing,
    pitch:
      previous.pitch === undefined || nextTarget.pitch === undefined
        ? nextTarget.pitch
        : previous.pitch + (nextTarget.pitch - previous.pitch) * smoothing,
    mode: nextTarget.mode,
    lastSeenAt: nextTarget.lastSeenAt,
  }
}

const setViewportTarget = (state: FaceAutoCenterState, face: FaceBox | undefined, time: number, center = face ? getFaceCenter(face) : undefined) => {
  if (!face || !center) return false
  smoothTarget(state, {
    x: center.x - VIEWPORT_TARGET_X,
    y: center.y - VIEWPORT_TARGET_Y,
    mode: 'viewport',
    lastSeenAt: time,
  })
  return true
}

const setPanoramaTarget = (
  state: FaceAutoCenterState,
  face: FaceBox | undefined,
  time: number,
  projectionPreset: ProjectionPreset,
  camera: PerspectiveCamera,
) => {
  if (!face) return false

  const center = getFaceCenter(face)
  const facePitch = (0.5 - center.y) * 180
  const targetYOffset = getViewportPitchOffset(camera, VIEWPORT_TARGET_Y)
  const yawSpan = getProjectionYawSpan(projectionPreset)
  const yawLimit = getProjectionYawLimit(projectionPreset)
  const yaw = (VIEWPORT_TARGET_X - center.x) * yawSpan
  smoothTarget(state, {
    x: center.x - VIEWPORT_TARGET_X,
    y: center.y - VIEWPORT_TARGET_Y,
    yaw: yawLimit === undefined ? yaw : clamp(yaw, -yawLimit, yawLimit),
    pitch: clamp(facePitch - targetYOffset, -75, 75),
    mode: 'panorama',
    lastSeenAt: time,
  })
  return true
}

const drawSampleBoxes = (state: FaceAutoCenterState, canvas: HTMLCanvasElement, context: CanvasRenderingContext2D, time: number, label: string) => {
  const freshFaces = state.faces.filter((face) => time - face.lastSeenAt < 1200)
  state.faces = freshFaces

  context.save()
  context.fillStyle = 'rgba(0, 0, 0, 0.58)'
  context.fillRect(0, 0, Math.min(110, canvas.width), 22)
  context.fillStyle = '#fff'
  context.font = 'bold 12px monospace'
  context.fillText(label, 8, 15)
  context.restore()

  freshFaces.forEach((face) => {
    const x = face.x * canvas.width
    const y = face.y * canvas.height
    const width = face.width * canvas.width
    const height = face.height * canvas.height

    context.save()
    context.strokeStyle = '#38ff8b'
    context.lineWidth = Math.max(2, canvas.width / 420)
    context.shadowColor = 'rgba(56, 255, 139, 0.6)'
    context.shadowBlur = canvas.width / 80
    context.strokeRect(x, y, width, height)
    context.shadowBlur = 0
    context.fillStyle = 'rgba(10, 132, 255, 0.9)'
    context.fillRect(x, Math.max(0, y - 18), 42, 18)
    context.fillStyle = '#fff'
    context.font = 'bold 12px monospace'
    context.fillText(`${Math.round(face.score * 100)}%`, x + 5, Math.max(12, y - 5))
    context.restore()
  })
}

const getViewportInferenceSampleSize = (sourceWidth: number, sourceHeight: number, sampleWidth: number) => {
  if (!sourceWidth || !sourceHeight) return undefined
  const aspect = sourceWidth / sourceHeight
  const width = Math.max(160, Math.round(sampleWidth))
  const height = Math.max(120, Math.round(width / aspect))
  return { width, height }
}

const drawPanoramaInferenceSample = (
  sampleCanvas: HTMLCanvasElement,
  context: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  sampleWidth: number,
  preset: ProjectionPreset,
  view: CameraView,
  camera: PerspectiveCamera,
): PanoramaSample | undefined => {
  if (!video.videoWidth || !video.videoHeight || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return undefined

  const crop = getSourceCrop(video, preset)
  const sampleYawSpan = Math.min(getProjectionYawSpan(preset), PANORAMA_SEARCH_DEGREES)
  const aspect = (crop.width * (sampleYawSpan / getProjectionYawSpan(preset))) / crop.height
  let width = Math.max(160, Math.round(sampleWidth))
  let height = Math.max(120, Math.round(width / Math.max(aspect, 0.25)))
  if (height > PANORAMA_SAMPLE_MAX_HEIGHT) {
    const scale = PANORAMA_SAMPLE_MAX_HEIGHT / height
    width = Math.max(1, Math.round(width * scale))
    height = PANORAMA_SAMPLE_MAX_HEIGHT
  }
  resizeCanvas(sampleCanvas, width, height)

  return drawPanoramaSample(context, video, crop, width, height, view, preset, camera)
}

export type VrSceneOptions = {
  root: HTMLElement
  mount: HTMLElement
  sampleCanvas: HTMLCanvasElement
  hintElement: HTMLElement
  fpsElement: HTMLElement
  video: HTMLVideoElement | null
  preset: ProjectionPreset
  quality: ProjectionQuality
  hidden: boolean
  splitScreen: boolean
  faceAutoCenter: boolean
  showDetectionPreview: boolean
  viewRef: MutableRefObject<CameraView>
  onZoomChange: (zoom: number) => void
}

export type VrSceneController = {
  update: (nextOptions: Partial<Pick<VrSceneOptions, 'preset' | 'quality' | 'hidden' | 'splitScreen' | 'faceAutoCenter' | 'showDetectionPreview'>>) => void
  destroy: () => void
}

export const createVrScene = (initialOptions: VrSceneOptions): VrSceneController | undefined => {
  if (!initialOptions.video) return undefined

  const mount = initialOptions.mount
  const sampleCanvas = initialOptions.sampleCanvas
  const video = initialOptions.video
  const options = { ...initialOptions, video }
  let disposed = false
  let frameId = 0
  let wakeTimer: number | undefined
  let videoFrameCallbackId = 0
  let lastFrameAt = performance.now()
  let fpsSampleStartedAt = lastFrameAt
  let fpsFrameCount = 0
  const recentFrameTimes: number[] = []
  const recentRenderTimes: number[] = []
  let lastRenderMs = 0
  let recentInferenceCompletions: number[] = []
  const recentInferenceTimes: number[] = []
  let lastInferenceMs = 0
  let lastCaptureMs = 0
  let lastInputSize = '--'
  let skippedInferenceFrames = 0
  let overlayVisible = !options.hintElement.hidden
  let lastOverlayText = options.hintElement.textContent ?? ''
  let lastOverlaySide = options.hintElement.dataset.side
  let lastOverlayTop = Number.NaN
  const scene = new Scene()
  scene.background = new Color('#000')
  const initialViewport = getRenderViewports(
    Math.max(1, mount.clientWidth),
    Math.max(1, mount.clientHeight),
    options.splitScreen,
  )[0]
  const camera = new PerspectiveCamera(DEFAULT_FOV, initialViewport.width / initialViewport.height, 0.1, 1000)
  camera.zoom = options.viewRef.current.zoom
  camera.updateProjectionMatrix()
  const renderer = new WebGLRenderer({
    antialias: true,
    precision: 'highp',
    powerPreference: 'high-performance',
  })
  renderer.outputColorSpace = SRGBColorSpace
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, QUALITY_OPTIONS.find((item) => item.component === options.quality)?.pixelRatio ?? 1))
  renderer.setSize(mount.clientWidth, mount.clientHeight, false)
  renderer.domElement.className = 'block h-dvh w-full saturate-105 contrast-102'
  mount.appendChild(renderer.domElement)

  const texture = new VideoTexture(video)
  texture.colorSpace = SRGBColorSpace
  texture.needsUpdate = true
  let projection = createProjectionGroup(video, texture, options.preset, options.quality)
  scene.add(projection)

  const faceState: FaceAutoCenterState = {
    faces: [],
    detectionMode: 'viewport',
    nextDetectionAt: 0,
    lastDetectionAt: 0,
    consecutiveMisses: 0,
    isMoving: false,
    yawVelocity: 0,
    pitchVelocity: 0,
    lastErrorAt: 0,
  }
  const sampleContext = sampleCanvas.getContext('2d', { alpha: false, willReadFrequently: true })
  const faceTracker = getFaceTrackerClient()
  let inferenceInFlight = false
  let inferenceGeneration = 0

  const hasCurrentVideoFrame = () =>
    video.videoWidth > 0 &&
    video.videoHeight > 0 &&
    video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA

  const clearWakeTimer = () => {
    if (wakeTimer !== undefined) {
      window.clearTimeout(wakeTimer)
      wakeTimer = undefined
    }
  }

  const stopScheduledRender = () => {
    clearWakeTimer()
    if (frameId) {
      window.cancelAnimationFrame(frameId)
      frameId = 0
    }
  }

  function requestRender() {
    if (disposed || frameId || options.hidden || !hasCurrentVideoFrame()) return
    clearWakeTimer()
    frameId = window.requestAnimationFrame(render)
  }

  const scheduleRenderAt = (time: number) => {
    if (disposed || wakeTimer !== undefined || options.hidden || !hasCurrentVideoFrame()) return
    wakeTimer = window.setTimeout(() => {
      wakeTimer = undefined
      requestRender()
    }, Math.max(0, time - performance.now()))
  }

  const setOverlay = (overlay: OverlayState) => {
    if (overlay.hint) {
      if (lastOverlayText !== overlay.hint.text) {
        options.hintElement.textContent = overlay.hint.text
        lastOverlayText = overlay.hint.text
      }
      if (lastOverlaySide !== overlay.hint.side) {
        options.hintElement.dataset.side = overlay.hint.side
        options.hintElement.classList.toggle('left-3.5', overlay.hint.side === 'left')
        options.hintElement.classList.toggle('right-3.5', overlay.hint.side === 'right')
        lastOverlaySide = overlay.hint.side
      }
      if (!Number.isFinite(lastOverlayTop) || Math.abs(lastOverlayTop - overlay.hint.top) >= 0.1) {
        options.hintElement.style.top = `${overlay.hint.top}%`
        lastOverlayTop = overlay.hint.top
      }
      if (!overlayVisible) {
        options.hintElement.hidden = false
        overlayVisible = true
      }
    } else if (overlayVisible) {
      options.hintElement.hidden = true
      overlayVisible = false
    }
  }

  const updateVisibility = () => {
    options.root.classList.toggle('opacity-0', options.hidden)
    options.root.classList.toggle('opacity-100', !options.hidden)
    options.root.setAttribute('aria-hidden', String(options.hidden))
    options.sampleCanvas.classList.toggle('hidden', !options.showDetectionPreview || !options.faceAutoCenter)
    options.fpsElement.classList.toggle('hidden', !options.showDetectionPreview)
    if (!options.showDetectionPreview) {
      options.fpsElement.textContent = 'FPS --  P95 -- ms'
      fpsFrameCount = 0
      fpsSampleStartedAt = performance.now()
      recentFrameTimes.length = 0
      recentRenderTimes.length = 0
      lastRenderMs = 0
      recentInferenceCompletions = []
      lastInferenceMs = 0
      lastCaptureMs = 0
      lastInputSize = '--'
      skippedInferenceFrames = 0
    }
  }

  const updatePerformanceMetrics = (now: number, frameTimeMs: number) => {
    fpsFrameCount += 1
    if (frameTimeMs > 0 && frameTimeMs < 1000) {
      recentFrameTimes.push(frameTimeMs)
      if (recentFrameTimes.length > 180) recentFrameTimes.shift()
    }

    const elapsed = now - fpsSampleStartedAt
    if (elapsed < 500) return

    const fps = Math.max(1, Math.round((fpsFrameCount * 1000) / elapsed))
    const sortedFrameTimes = [...recentFrameTimes].sort((a, b) => a - b)
    const p95Index = Math.max(0, Math.ceil(sortedFrameTimes.length * 0.95) - 1)
    const p95 = sortedFrameTimes[p95Index] ?? 0
    const sortedRenderTimes = [...recentRenderTimes].sort((a, b) => a - b)
    const renderP95Index = Math.max(0, Math.ceil(sortedRenderTimes.length * 0.95) - 1)
    const renderP95 = sortedRenderTimes[renderP95Index] ?? 0
    recentInferenceCompletions = recentInferenceCompletions.filter((time) => now - time <= 2000)
    const trackingSpan = recentInferenceCompletions.length > 1
      ? recentInferenceCompletions[recentInferenceCompletions.length - 1] - recentInferenceCompletions[0]
      : 0
    const trackingHz = trackingSpan > 0
      ? ((recentInferenceCompletions.length - 1) * 1000) / trackingSpan
      : 0

    const splitCount = getRenderViewports(mount.clientWidth, mount.clientHeight, options.splitScreen).length
    const renderStrategy = splitCount <= 1
      ? 'Single view'
      : `Split ${splitCount} · render ${splitCount}×`

    options.fpsElement.textContent = [
      `FPS ${fps}  P95 ${p95.toFixed(1)} ms`,
      renderStrategy,
      `Render CPU ${lastRenderMs.toFixed(2)} ms  P95 ${renderP95.toFixed(2)} ms`,
      `Track ${trackingHz.toFixed(1)} Hz  Infer ${lastInferenceMs.toFixed(1)} ms`,
      `Capture ${lastCaptureMs.toFixed(1)} ms  Skipped ${skippedInferenceFrames}`,
      `${faceTracker.getBackendLabel()}  Input ${lastInputSize}`,
    ].join('\n')
    fpsFrameCount = 0
    fpsSampleStartedAt = now
  }

  const resize = () => {
    const width = Math.max(1, mount.clientWidth)
    const height = Math.max(1, mount.clientHeight)
    const primaryViewport = getRenderViewports(width, height, options.splitScreen)[0]
    camera.aspect = primaryViewport.width / primaryViewport.height
    camera.updateProjectionMatrix()
    renderer.setSize(width, height, false)
    requestRender()
  }

  const rebuildProjection = () => {
    scene.remove(projection)
    disposeObject(projection)
    projection = createProjectionGroup(video, texture, options.preset, options.quality)
    scene.add(projection)
  }

  const onMetadata = () => {
    rebuildProjection()
    faceState.nextDetectionAt = 0
    requestRender()
  }
  video.addEventListener('loadedmetadata', onMetadata)

  const onVideoActivity = () => {
    faceState.nextDetectionAt = 0
    requestRender()
  }
  video.addEventListener('playing', onVideoActivity)
  video.addEventListener('pause', onVideoActivity)
  video.addEventListener('seeked', onVideoActivity)
  video.addEventListener('loadeddata', onVideoActivity)

  if ('requestVideoFrameCallback' in video) {
    const onVideoFrame = () => {
      if (disposed) return
      videoFrameCallbackId = video.requestVideoFrameCallback(onVideoFrame)
      requestRender()
    }
    videoFrameCallbackId = video.requestVideoFrameCallback(onVideoFrame)
  }

  const resizeObserver = new ResizeObserver(resize)
  resizeObserver.observe(mount)

  const pauseFaceCenter = () => {
    options.viewRef.current.pausedUntil = performance.now() + 1800
    faceState.nextDetectionAt = options.viewRef.current.pausedUntil
    faceState.yawVelocity = 0
    faceState.pitchVelocity = 0
    faceState.isMoving = false
    requestRender()
  }

  const dragging = { active: false, pointerId: 0, x: 0, y: 0 }
  const onPointerDown = (event: PointerEvent) => {
    dragging.active = true
    dragging.pointerId = event.pointerId
    dragging.x = event.clientX
    dragging.y = event.clientY
    renderer.domElement.setPointerCapture?.(event.pointerId)
    pauseFaceCenter()
    requestRender()
  }
  const onPointerMove = (event: PointerEvent) => {
    if (!dragging.active || dragging.pointerId !== event.pointerId) return
    const dx = event.clientX - dragging.x
    const dy = event.clientY - dragging.y
    dragging.x = event.clientX
    dragging.y = event.clientY
    options.viewRef.current.yaw += dx * 0.08
    options.viewRef.current.pitch = clamp(options.viewRef.current.pitch + dy * 0.08, -85, 85)
    requestRender()
  }
  const onPointerUp = (event: PointerEvent) => {
    if (dragging.pointerId !== event.pointerId) return
    dragging.active = false
    renderer.domElement.releasePointerCapture?.(event.pointerId)
    requestRender()
  }
  const onWheel = (event: WheelEvent) => {
    event.preventDefault()
    pauseFaceCenter()
    const nextZoom = clamp(options.viewRef.current.zoom - event.deltaY * WHEEL_ZOOM_SPEED, MIN_ZOOM, MAX_ZOOM)
    options.viewRef.current.zoom = nextZoom
    options.onZoomChange(nextZoom)
    requestRender()
  }

  renderer.domElement.addEventListener('pointerdown', onPointerDown)
  renderer.domElement.addEventListener('pointermove', onPointerMove)
  renderer.domElement.addEventListener('pointerup', onPointerUp)
  renderer.domElement.addEventListener('pointercancel', onPointerUp)
  renderer.domElement.addEventListener('wheel', onWheel, { passive: false })

  const updateInferenceSchedule = (now: number, completedInferenceMs = 0) => {
    const recoveryPending = faceState.recoveryMode !== undefined
    const configuredPeriod = (
      recoveryPending
        ? FACE_RECOVERY_INTERVAL_MS
        : faceState.isMoving
          ? FACE_TRACK_ACTIVE_INTERVAL_MS
          : FACE_TRACK_STABLE_INTERVAL_MS
    )
    const sortedInferenceTimes = [...recentInferenceTimes].sort((a, b) => a - b)
    const p95Index = Math.max(0, Math.ceil(sortedInferenceTimes.length * 0.95) - 1)
    const inferenceP95 = sortedInferenceTimes[p95Index] ?? 0
    const adaptivePeriod = Math.max(
      configuredPeriod,
      Math.min(FACE_INFERENCE_MAX_PERIOD_MS, inferenceP95 * FACE_INFERENCE_HEADROOM),
    )
    // Keep the adaptive period measured from inference start to inference start.
    faceState.nextDetectionAt = now + Math.max(0, adaptivePeriod - completedInferenceMs)
  }

  const updateTrackingResult = (foundFace: boolean, time: number) => {
    if (foundFace) {
      faceState.consecutiveMisses = 0
      return
    }

    faceState.consecutiveMisses += 1
    if (faceState.target && time - faceState.target.lastSeenAt > FACE_TARGET_GRACE_MS) {
      faceState.target = undefined
    }
    if (faceState.consecutiveMisses >= 3 && !faceState.target) {
      faceState.selectedFace = undefined
    }
  }

  const applyInferenceResult = (
    result: FaceInferenceResult,
    detectionMode: DetectionMode,
    panoramaSample: PanoramaSample | undefined,
    preset: ProjectionPreset,
  ) => {
    const time = result.timestamp
    const completedAt = performance.now()
    lastInferenceMs = result.inferenceMs
    recentInferenceTimes.push(result.inferenceMs)
    if (recentInferenceTimes.length > 20) recentInferenceTimes.shift()
    recentInferenceCompletions.push(completedAt)
    let foundFace = false

    if (result.mode === 'landmarks') {
      const normalizedFace = result.faces[0]
      const face = normalizedFace ? { ...normalizedFace, lastSeenAt: time } : undefined
      faceState.lastDetectionAt = time
      faceState.detectionMode = 'viewport'
      faceState.faces = face ? [face] : []
      faceState.selectedFace = face ? { ...face, mode: 'viewport' } : faceState.selectedFace
      foundFace = setViewportTarget(faceState, face, time, result.center)
      faceState.recoveryMode = foundFace ? undefined : 'viewport'
    } else if (detectionMode === 'panorama' && panoramaSample) {
      faceState.detectionMode = 'panorama'
      const face = applyDetections(faceState, result.faces, time, 'panorama', {
        x: panoramaSample.center.x,
        y: panoramaSample.center.y,
        weight: PANORAMA_DIRECTION_ANCHOR_WEIGHT,
        wrapX: panoramaSample.wraps,
      }, (sampleFace) => mapSampleFaceToPanorama(sampleFace, panoramaSample))
      foundFace = setPanoramaTarget(faceState, face, time, preset, camera)
      faceState.recoveryMode = undefined
    } else {
      faceState.detectionMode = 'viewport'
      const face = applyDetections(faceState, result.faces, time, 'viewport')
      foundFace = setViewportTarget(faceState, face, time)
      faceState.recoveryMode = foundFace ? undefined : 'panorama'
    }

    updateTrackingResult(foundFace, time)
    if (options.showDetectionPreview) {
      drawSampleBoxes(faceState, sampleCanvas, sampleContext!, performance.now(), faceState.detectionMode)
    }
  }

  const submitInference = (now: number) => {
    if (!sampleContext || inferenceInFlight) return

    const captureStartedAt = performance.now()
    let mode: FaceInferenceMode = 'landmarks'
    let detectionMode: DetectionMode = 'viewport'
    let panoramaSample: PanoramaSample | undefined
    let bitmapPromise: Promise<ImageBitmap> | undefined
    let inputWidth = 0
    let inputHeight = 0
    let completedInferenceMs = 0
    const preset = options.preset

    try {
      if (faceState.recoveryMode === 'panorama') {
        mode = 'detection'
        detectionMode = 'panorama'
        panoramaSample = drawPanoramaInferenceSample(
          sampleCanvas,
          sampleContext,
          video,
          PANORAMA_SAMPLE_WIDTH,
          preset,
          options.viewRef.current,
          camera,
        )
        if (!panoramaSample) return
        inputWidth = sampleCanvas.width
        inputHeight = sampleCanvas.height
      } else {
        mode = faceState.recoveryMode === 'viewport' ? 'detection' : 'landmarks'
        const renderViewports = getRenderViewports(renderer.domElement.width, renderer.domElement.height, options.splitScreen)
        const sourceRect = renderViewports[Math.floor(renderViewports.length / 2)]
        const size = getViewportInferenceSampleSize(sourceRect.width, sourceRect.height, VIEWPORT_SAMPLE_WIDTH)
        if (!size) return
        inputWidth = size.width
        inputHeight = size.height
        bitmapPromise = createImageBitmap(
          renderer.domElement,
          sourceRect.x,
          sourceRect.y,
          sourceRect.width,
          sourceRect.height,
          {
            resizeWidth: inputWidth,
            resizeHeight: inputHeight,
            resizeQuality: 'low',
          },
        )
      }
    } catch (error) {
      if (now - faceState.lastErrorAt > 3000) {
        faceState.lastErrorAt = now
        console.warn('face auto center could not capture inference frame', error)
      }
      updateInferenceSchedule(now)
      return
    }

    const generation = inferenceGeneration
    lastInputSize = `${inputWidth}×${inputHeight}`
    inferenceInFlight = true
    updateInferenceSchedule(now)
    void (bitmapPromise ?? createImageBitmap(sampleCanvas))
      .then((bitmap) => {
        lastCaptureMs = performance.now() - captureStartedAt
        if (options.showDetectionPreview && detectionMode === 'viewport') {
          resizeCanvas(sampleCanvas, inputWidth, inputHeight)
          sampleContext.drawImage(bitmap, 0, 0, inputWidth, inputHeight)
        }
        return faceTracker.infer(mode, bitmap, now)
      })
      .then((result) => {
        completedInferenceMs = result.inferenceMs
        if (disposed || generation !== inferenceGeneration || !options.faceAutoCenter || options.hidden) return
        applyInferenceResult(result, detectionMode, panoramaSample, preset)
      })
      .catch((error) => {
        if (disposed || generation !== inferenceGeneration) return
        if (performance.now() - faceState.lastErrorAt > 3000) {
          faceState.lastErrorAt = performance.now()
          console.warn('face tracking worker inference failed', error)
        }
      })
      .finally(() => {
        inferenceInFlight = false
        if (!disposed && generation === inferenceGeneration) {
          updateInferenceSchedule(performance.now(), completedInferenceMs)
          requestRender()
        }
      })
  }

  const runFaceAutoCenter = (now: number, delta: number) => {
    if (!sampleContext) return

    if (!options.faceAutoCenter || options.hidden) {
      faceState.faces = []
      faceState.target = undefined
      faceState.recoveryMode = undefined
      faceState.consecutiveMisses = 0
      faceState.yawVelocity = 0
      faceState.pitchVelocity = 0
      faceState.isMoving = false
      setOverlay({})
      return
    }

    if (!video.videoWidth || !video.videoHeight || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      faceState.faces = []
      faceState.target = undefined
      faceState.recoveryMode = undefined
      faceState.yawVelocity = 0
      faceState.pitchVelocity = 0
      faceState.isMoving = false
      setOverlay({})
      return
    }

    if (now < options.viewRef.current.pausedUntil) return

    if (now >= faceState.nextDetectionAt) {
      if (inferenceInFlight) {
        skippedInferenceFrames += 1
        updateInferenceSchedule(now)
      } else {
        submitInference(now)
      }
    }

    const frameDelta = clamp(delta || 1 / 60, 1 / 240, 0.05)
    const velocityBlend = 1 - Math.exp(-(frameDelta * 1000) / FACE_CENTER_VELOCITY_SMOOTHING_MS)
    const updateVelocity = (current: number, desired: number) => {
      const next = current + (desired - current) * velocityBlend
      return Math.abs(next) < FACE_CENTER_STOP_SPEED && desired === 0 ? 0 : next
    }
    const target = faceState.target
    const targetMaxAge = faceState.isMoving ? 4500 : 1100
    if (!target || now - target.lastSeenAt > targetMaxAge) {
      faceState.yawVelocity = updateVelocity(faceState.yawVelocity, 0)
      faceState.pitchVelocity = updateVelocity(faceState.pitchVelocity, 0)
      faceState.isMoving = faceState.yawVelocity !== 0 || faceState.pitchVelocity !== 0
      const yawLimit = getProjectionYawLimit(options.preset)
      const yawStep = faceState.yawVelocity * frameDelta
      options.viewRef.current.yaw =
        yawLimit === undefined
          ? options.viewRef.current.yaw + yawStep
          : clamp(shortestAngle(options.viewRef.current.yaw) + yawStep, -yawLimit, yawLimit)
      options.viewRef.current.pitch = clamp(
        options.viewRef.current.pitch + faceState.pitchVelocity * frameDelta,
        -85,
        85,
      )
      setOverlay({})
      return
    }

    const viewportFaceX = VIEWPORT_TARGET_X + target.x
    const viewportFaceY = VIEWPORT_TARGET_Y + target.y
    const yawError = target.yaw === undefined
      ? getViewportYawOffset(camera, viewportFaceX) - getViewportYawOffset(camera, VIEWPORT_TARGET_X)
      : shortestAngle(target.yaw - options.viewRef.current.yaw)
    const pitchError = target.pitch === undefined
      ? getViewportPitchOffset(camera, viewportFaceY) - getViewportPitchOffset(camera, VIEWPORT_TARGET_Y)
      : target.pitch - options.viewRef.current.pitch
    const yawDeadZone = target.yaw === undefined
      ? Math.abs(getViewportYawOffset(camera, VIEWPORT_TARGET_X + VIEWPORT_DEAD_ZONE_X) - getViewportYawOffset(camera, VIEWPORT_TARGET_X))
      : 6
    const pitchDeadZone = target.yaw === undefined
      ? Math.abs(getViewportPitchOffset(camera, VIEWPORT_TARGET_Y + VIEWPORT_DEAD_ZONE_Y) - getViewportPitchOffset(camera, VIEWPORT_TARGET_Y))
      : 7
    // Remove the dead zone from the error instead of switching the full error
    // on and off at its edge. This lets the camera ease to a stop smoothly.
    const x = Math.sign(yawError) * Math.max(0, Math.abs(yawError) - yawDeadZone)
    const y = Math.sign(pitchError) * Math.max(0, Math.abs(pitchError) - pitchDeadZone)
    const hint =
      Math.abs(yawError) >= 18
        ? {
            side: yawError > 0 ? ('right' as const) : ('left' as const),
            top: 50 + clamp(-pitchError, -42, 42) * 0.32,
            text: `${yawError > 0 ? '→' : '←'} ${Math.round(Math.abs(yawError))}°`,
          }
        : undefined

    setOverlay({ hint })
    if (!x && !y) faceState.offCenterSince = undefined
    else faceState.offCenterSince ??= now
    const panoramaTarget = target.mode === 'panorama'
    const farTarget = Math.abs(yawError) > 70
    const response = FACE_CENTER_RESPONSE * (panoramaTarget ? 1.25 : farTarget ? 1.1 : 1)
    const maxSpeed = FACE_CENTER_MAX_SPEED * (panoramaTarget ? 1.35 : farTarget ? 1.15 : 1)
    const desiredYawVelocity = clamp(x * response, -maxSpeed, maxSpeed)
    const desiredPitchVelocity = clamp(y * response, -maxSpeed, maxSpeed)
    faceState.yawVelocity = updateVelocity(faceState.yawVelocity, desiredYawVelocity)
    faceState.pitchVelocity = updateVelocity(faceState.pitchVelocity, desiredPitchVelocity)
    const yawStep = faceState.yawVelocity * frameDelta
    const pitchStep = faceState.pitchVelocity * frameDelta
    const yawLimit = getProjectionYawLimit(options.preset)

    faceState.isMoving = faceState.yawVelocity !== 0 || faceState.pitchVelocity !== 0
    options.viewRef.current.yaw =
      yawLimit === undefined
        ? options.viewRef.current.yaw + yawStep
        : clamp(shortestAngle(options.viewRef.current.yaw) + yawStep, -yawLimit, yawLimit)
    options.viewRef.current.pitch = clamp(options.viewRef.current.pitch + pitchStep, -85, 85)
  }

  const render = (now: number) => {
    if (disposed) return
    frameId = 0
    const delta = (now - lastFrameAt) / 1000
    lastFrameAt = now
    if (camera.zoom !== options.viewRef.current.zoom) {
      camera.zoom = options.viewRef.current.zoom
      camera.updateProjectionMatrix()
    }
    camera.rotation.set(MathUtils.degToRad(options.viewRef.current.pitch), MathUtils.degToRad(options.viewRef.current.yaw), 0, 'YXZ')
    const renderStartedAt = performance.now()
    const viewports = getRenderViewports(mount.clientWidth, mount.clientHeight, options.splitScreen)
    renderer.setScissorTest(viewports.length > 1)
    renderer.setViewport(0, 0, mount.clientWidth, mount.clientHeight)
    renderer.setScissor(0, 0, mount.clientWidth, mount.clientHeight)
    const renderViewport = (viewport: RenderViewport) => {
      renderer.setViewport(viewport.x, viewport.y, viewport.width, viewport.height)
      renderer.setScissor(viewport.x, viewport.y, viewport.width, viewport.height)
      renderer.render(scene, camera)
    }

    viewports.forEach(renderViewport)
    renderer.setScissorTest(false)
    lastRenderMs = performance.now() - renderStartedAt
    recentRenderTimes.push(lastRenderMs)
    if (recentRenderTimes.length > 180) recentRenderTimes.shift()
    if (options.showDetectionPreview) updatePerformanceMetrics(now, delta * 1000)
    // Sample immediately after rendering so WebGL does not need an expensive
    // preserveDrawingBuffer allocation just for face tracking.
    runFaceAutoCenter(now, delta)

    if (options.hidden || !hasCurrentVideoFrame()) return
    if (dragging.active || faceState.isMoving) {
      requestRender()
      return
    }
    if (!video.paused) {
      if (!('requestVideoFrameCallback' in video)) requestRender()
      return
    }
    if (!options.faceAutoCenter || inferenceInFlight) return
    if (now < options.viewRef.current.pausedUntil) {
      scheduleRenderAt(options.viewRef.current.pausedUntil)
      return
    }
    if (faceState.recoveryMode !== undefined || (!faceState.target && faceState.consecutiveMisses < 3)) {
      scheduleRenderAt(Math.max(now + 16, faceState.nextDetectionAt))
    }
  }

  updateVisibility()
  requestRender()

  return {
    update(nextOptions) {
      const shouldRebuild = nextOptions.preset !== undefined || nextOptions.quality !== undefined
      const enablesDebugPreview = nextOptions.showDetectionPreview === true && !options.showDetectionPreview
      const invalidatesInference =
        nextOptions.preset !== undefined ||
        nextOptions.hidden !== undefined ||
        nextOptions.faceAutoCenter !== undefined
      if (invalidatesInference) inferenceGeneration += 1
      Object.assign(options, nextOptions)
      if (enablesDebugPreview) {
        fpsFrameCount = 0
        fpsSampleStartedAt = performance.now()
        recentFrameTimes.length = 0
        recentRenderTimes.length = 0
        lastRenderMs = 0
        recentInferenceCompletions = []
        lastInferenceMs = 0
        lastCaptureMs = 0
        lastInputSize = '--'
        skippedInferenceFrames = 0
        options.fpsElement.textContent = 'FPS --  P95 -- ms'
      }
      if (nextOptions.quality !== undefined) {
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, QUALITY_OPTIONS.find((item) => item.component === options.quality)?.pixelRatio ?? 1))
      }
      if (shouldRebuild) {
        rebuildProjection()
      }
      if (nextOptions.splitScreen !== undefined) resize()
      updateVisibility()
      if (options.hidden) {
        stopScheduledRender()
      } else {
        if (nextOptions.faceAutoCenter === true || nextOptions.preset !== undefined) {
          faceState.nextDetectionAt = 0
        }
        requestRender()
      }
    },
    destroy() {
      disposed = true
      inferenceGeneration += 1
      stopScheduledRender()
      if (videoFrameCallbackId) video.cancelVideoFrameCallback(videoFrameCallbackId)
      video.removeEventListener('loadedmetadata', onMetadata)
      video.removeEventListener('playing', onVideoActivity)
      video.removeEventListener('pause', onVideoActivity)
      video.removeEventListener('seeked', onVideoActivity)
      video.removeEventListener('loadeddata', onVideoActivity)
      resizeObserver.disconnect()
      renderer.domElement.removeEventListener('pointerdown', onPointerDown)
      renderer.domElement.removeEventListener('pointermove', onPointerMove)
      renderer.domElement.removeEventListener('pointerup', onPointerUp)
      renderer.domElement.removeEventListener('pointercancel', onPointerUp)
      renderer.domElement.removeEventListener('wheel', onWheel)
      scene.remove(projection)
      disposeObject(projection)
      texture.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    }
  }
}
