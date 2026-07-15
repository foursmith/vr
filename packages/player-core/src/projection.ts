import type {
  BufferAttribute,
  BufferGeometry,
  Object3D,
  Side,
  Texture,
  VideoTexture,
} from "three"
import type { ProjectionMode, ProjectionQuality } from "./config"
import {
  BackSide,
  FrontSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SphereGeometry,
} from "three"

const PROJECTION_SEGMENTS = { eqrHalfWidth: 96, eqrFullWidth: 128, eqrHeight: 64, fisheye: 96 }

const getUv = (geometry: BufferGeometry) => geometry.attributes.uv as BufferAttribute

const setUvCrop = (geometry: BufferGeometry, repeat: { x: number, y: number }, offset: { x: number, y: number }) => {
  const uv = getUv(geometry)
  for (let i = 0; i < uv.count; i += 1) {
    uv.setXY(i, uv.getX(i) * repeat.x + offset.x, uv.getY(i) * repeat.y + offset.y)
  }
  uv.needsUpdate = true
}

const createFisheyeGeometry = (stereo: boolean, segments: number) => {
  const geometry = new SphereGeometry(100, segments, segments)
  geometry.rotateX(-Math.PI / 2)
  geometry.rotateY(Math.PI)

  const uv = getUv(geometry)
  for (let i = 0; i < uv.count; i += 1) {
    const theta = 2 * Math.PI * uv.getX(i)
    const radius = Math.PI * uv.getY(i) / Math.PI
    let u = 0.5 + radius * Math.cos(theta)
    const v = 0.5 + radius * Math.sin(theta)
    if (stereo) u *= 0.5
    uv.setXY(i, u, v)
  }
  uv.needsUpdate = true
  return geometry
}

const createVideoMaterial = (texture: Texture, side: Side) => new MeshBasicMaterial({ map: texture, side, toneMapped: false })

const createMask = () => {
  const mask = new Mesh(
    new SphereGeometry(99, 32, 8, 0, Math.PI * 2, 0, Math.PI / 2),
    new MeshBasicMaterial({ color: "#14120f", side: BackSide }),
  )
  mask.rotation.x = Math.PI / 2
  return mask
}

export const createProjectionGroup = (
  video: HTMLVideoElement,
  texture: VideoTexture,
  projection: ProjectionMode,
  _quality: ProjectionQuality,
) => {
  const group = new Group()
  const segments = PROJECTION_SEGMENTS

  switch (projection) {
    case "sbs_180_eqr": {
      const geometry = new SphereGeometry(100, segments.eqrHalfWidth, segments.eqrHeight, Math.PI, Math.PI, 0, Math.PI)
      setUvCrop(geometry, { x: -0.5, y: 1 }, { x: 0.5, y: 0 })
      group.add(new Mesh(geometry, createVideoMaterial(texture, BackSide)))
      break
    }
    case "sbs_180_fe":
      group.add(new Mesh(createFisheyeGeometry(true, segments.fisheye), createVideoMaterial(texture, BackSide)))
      group.add(createMask())
      break
    case "tb_360_eqr": {
      const geometry = new SphereGeometry(100, segments.eqrFullWidth, segments.eqrHeight, 0, Math.PI * 2, 0, Math.PI)
      setUvCrop(geometry, { x: 1, y: 0.5 }, { x: 0, y: 0.5 })
      const mesh = new Mesh(geometry, createVideoMaterial(texture, BackSide))
      mesh.scale.set(-1, 1, 1)
      mesh.rotation.y = -Math.PI / 2
      group.add(mesh)
      break
    }
    case "flat_2d": {
      const height = 60
      const aspect = video.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : 1.77
      group.add(new Mesh(new SphereGeometry(120, 32, 16), new MeshBasicMaterial({ color: "#14120f", side: BackSide })))
      const screen = new Mesh(new PlaneGeometry(height * aspect, height), createVideoMaterial(texture, FrontSide))
      screen.position.set(0, 10, -65)
      group.add(screen)
      break
    }
    case "m_180_eqr": {
      const mesh = new Mesh(
        new SphereGeometry(100, segments.eqrHalfWidth, segments.eqrHeight, Math.PI, Math.PI, 0, Math.PI),
        createVideoMaterial(texture, BackSide),
      )
      mesh.scale.set(-1, 1, 1)
      group.add(mesh)
      break
    }
    case "mono_360_eqr": {
      const mesh = new Mesh(
        new SphereGeometry(100, segments.eqrFullWidth, segments.eqrHeight, 0, Math.PI * 2, 0, Math.PI),
        createVideoMaterial(texture, BackSide),
      )
      mesh.scale.set(-1, 1, 1)
      mesh.rotation.y = -Math.PI / 2
      group.add(mesh)
      break
    }
    case "m_180_fe":
      group.add(new Mesh(createFisheyeGeometry(false, segments.fisheye), createVideoMaterial(texture, BackSide)))
      group.add(createMask())
      break
  }
  return group
}

export const disposeObject = (object: Object3D) => {
  object.traverse((child) => {
    const mesh = child as Mesh
    mesh.geometry?.dispose()
    const material = mesh.material
    if (Array.isArray(material)) material.forEach(item => item.dispose())
    else material?.dispose()
  })
}
