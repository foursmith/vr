import type { WebGLRendererParameters } from "three"
import type { ProjectionMode, ProjectionQuality } from "./config"
import {
  Color,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  VideoTexture,
  WebGLRenderer,
} from "three"
import { DEFAULT_FOV, projectionPixelRatio } from "./config"
import { createProjectionGroup, disposeObject } from "./projection"

export interface VrPlayerCoreOptions {
  video: HTMLVideoElement
  canvas?: HTMLCanvasElement
  projection: ProjectionMode
  quality: ProjectionQuality
  width: number
  height: number
  aspect?: number
  devicePixelRatio?: number
  fov?: number
  renderer?: Omit<WebGLRendererParameters, "canvas">
}

export const createVrPlayerCore = (initialOptions: VrPlayerCoreOptions) => {
  const video = initialOptions.video
  let projectionMode = initialOptions.projection
  let quality = initialOptions.quality
  let disposed = false
  const initialWidth = Math.max(1, initialOptions.width)
  const initialHeight = Math.max(1, initialOptions.height)
  const scene = new Scene()
  scene.background = new Color("#000")
  const camera = new PerspectiveCamera(
    initialOptions.fov ?? DEFAULT_FOV,
    initialOptions.aspect ?? initialWidth / initialHeight,
    0.1,
    1000,
  )
  const renderer = new WebGLRenderer({
    antialias: true,
    precision: "highp",
    powerPreference: "high-performance",
    ...initialOptions.renderer,
    canvas: initialOptions.canvas,
  })
  renderer.outputColorSpace = SRGBColorSpace
  const texture = new VideoTexture(video)
  texture.colorSpace = SRGBColorSpace
  texture.needsUpdate = true
  let projection = createProjectionGroup(video, texture, projectionMode, quality)
  scene.add(projection)

  const setQuality = (nextQuality: ProjectionQuality, devicePixelRatio = 1) => {
    quality = nextQuality
    renderer.setPixelRatio(projectionPixelRatio(quality, devicePixelRatio))
  }

  const setSize = (width: number, height: number, aspect = width / height) => {
    camera.aspect = aspect
    camera.updateProjectionMatrix()
    renderer.setSize(Math.max(1, width), Math.max(1, height), false)
  }

  const setProjection = (nextProjection: ProjectionMode) => {
    projectionMode = nextProjection
    scene.remove(projection)
    disposeObject(projection)
    projection = createProjectionGroup(video, texture, projectionMode, quality)
    scene.add(projection)
  }

  setQuality(quality, initialOptions.devicePixelRatio)
  setSize(initialWidth, initialHeight, initialOptions.aspect)

  return {
    camera,
    renderer,
    scene,
    texture,
    get projection() {
      return projection
    },
    render: () => renderer.render(scene, camera),
    resetMedia: () => {
      texture.needsUpdate = true
      renderer.renderLists.dispose()
    },
    setProjection,
    setQuality,
    setSize,
    destroy: () => {
      if (disposed) return
      disposed = true
      scene.remove(projection)
      disposeObject(projection)
      texture.dispose()
      renderer.dispose()
      renderer.forceContextLoss()
      renderer.domElement.width = 1
      renderer.domElement.height = 1
    },
  }
}
