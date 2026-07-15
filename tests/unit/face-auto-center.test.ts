import type { FaceAutoCenterState, FaceBox } from "../../src/features/vr/face-auto-center"
import { PerspectiveCamera } from "three"
import { describe, expect, it } from "vitest"
import { applyDetections, getFaceCenter, getProjectionYawLimit, mapSampleFaceToPanorama, setPanoramaTarget, setViewportTarget, updateFaceMotion } from "../../src/features/vr/face-auto-center"

const state = (): FaceAutoCenterState => ({
  faces: [],
  detectionMode: "viewport",
  nextDetectionAt: 0,
  lastDetectionAt: 0,
  consecutiveMisses: 0,
  isMoving: false,
  yawVelocity: 0,
  pitchVelocity: 0,
  lastErrorAt: 0,
})
const face = (overrides: Partial<FaceBox> = {}): FaceBox => ({ x: 0.2, y: 0.1, width: 0.2, height: 0.3, score: 0.9, lastSeenAt: 10, ...overrides })

describe("face auto-center", () => {
  it("computes centers and projection yaw limits", () => {
    expect(getFaceCenter(face()).x).toBeCloseTo(0.3)
    expect(getFaceCenter(face()).y).toBeCloseTo(0.25)
    expect(getProjectionYawLimit("sbs_180_eqr")).toBe(86)
    expect(getProjectionYawLimit("mono_360_eqr")).toBeUndefined()
  })

  it("smooths face movement and detects a receding subject", () => {
    const value = state()
    updateFaceMotion(value, face({ x: 0.4, y: 0.3, width: 0.3, height: 0.4 }), 100)
    const motion = updateFaceMotion(value, face({ x: 0.5, y: 0.3, width: 0.2, height: 0.3 }), 600)
    expect(motion.speed).toBeGreaterThan(0)
    expect(motion.recedingSpeed).toBeGreaterThan(0)
    expect(motion.size).toBeCloseTo(Math.sqrt(0.06))
  })

  it("maps wrapped samples back onto panorama coordinates", () => {
    const mapped = mapSampleFaceToPanorama(face({ x: 0.8, width: 0.2 }), { center: { x: 0, y: 0.5 }, startX: 0.9, widthX: 0.3, wraps: true })
    expect(getFaceCenter(mapped).x).toBeCloseTo(0.17)
    expect(mapped.width).toBeCloseTo(0.06)
  })

  it("maps perspective tile detections back onto panorama coordinates", () => {
    const mapped = mapSampleFaceToPanorama(face({ x: 0.4, y: 0.35, width: 0.2, height: 0.3 }), {
      center: { x: 0.25, y: 0.5 },
      startX: 0,
      widthX: 1,
      wraps: true,
      perspective: { yaw: 90, pitch: 0, fov: 90, aspect: 1, yawSpan: 360 },
    })
    expect(getFaceCenter(mapped).x).toBeCloseTo(0.25)
    expect(getFaceCenter(mapped).y).toBeCloseTo(0.5)
  })

  it("preserves the full yaw angle when mapping a 180-degree perspective tile", () => {
    const mapped = mapSampleFaceToPanorama(face({ x: 0.4, y: 0.35, width: 0.2, height: 0.3 }), {
      center: { x: 0.11, y: 0.5 },
      startX: 0,
      widthX: 1,
      wraps: false,
      perspective: { yaw: 70, pitch: 0, fov: 90, aspect: 1, yawSpan: 180 },
    })
    expect((0.5 - getFaceCenter(mapped).x) * 180).toBeCloseTo(70)
  })

  it("clamps non-wrapped sample faces to panorama bounds", () => {
    const left = mapSampleFaceToPanorama(face({ x: -2, width: 0.4 }), { center: { x: 0, y: 0.5 }, startX: 0.1, widthX: 0.5, wraps: false })
    const right = mapSampleFaceToPanorama(face({ x: 2, width: 0.4 }), { center: { x: 1, y: 0.5 }, startX: 0.5, widthX: 0.5, wraps: false })
    expect(left.x).toBe(0)
    expect(right.x).toBeCloseTo(0.8)
  })

  it("rejects low-confidence detections and keeps a stable prior face", () => {
    const value = state()
    const first = applyDetections(value, [face({ x: 0.1 })], 100, "viewport")
    expect(first?.x).toBe(0.1)
    const next = applyDetections(value, [face({ x: 0.12 }), face({ x: 0.7, width: 0.35 })], 200, "viewport")
    expect(next?.x).toBeCloseTo(0.12)
    expect(applyDetections(value, [face({ score: 0.49 })], 300, "viewport")).toBeUndefined()
  })

  it("uses a directional anchor to select the intended face", () => {
    const value = state()
    const selected = applyDetections(
      value,
      [face({ x: 0.1, width: 0.1 }), face({ x: 0.75, width: 0.1 })],
      100,
      "panorama",
      { x: 0.82, y: 0.25, weight: 3, wrapX: true },
    )
    expect(selected?.x).toBe(0.75)
  })

  it("preserves panorama face continuity across the horizontal seam", () => {
    const value = state()
    applyDetections(value, [face({ x: 0.94, width: 0.04 })], 100, "panorama")
    const selected = applyDetections(
      value,
      [face({ x: 0.01, width: 0.04 }), face({ x: 0.45, width: 0.2 })],
      200,
      "panorama",
    )
    expect(selected?.x).toBe(0.01)
  })

  it("sets viewport and clamped panorama targets", () => {
    const value = state()
    expect(setViewportTarget(value, face(), 100)).toBe(true)
    expect(value.target?.mode).toBe("viewport")
    expect(value.target?.x).toBeCloseTo(-0.2)
    const camera = new PerspectiveCamera(80, 16 / 9)
    expect(setPanoramaTarget(value, face({ x: -1, width: 0.1 }), 200, "sbs_180_eqr", camera)).toBe(true)
    expect(value.target?.yaw).toBe(86)
    expect(setViewportTarget(value, undefined, 300)).toBe(false)
  })

  it("smooths panorama yaw over the shortest wrapped angle", () => {
    const value = state()
    const camera = new PerspectiveCamera(80, 16 / 9)
    setPanoramaTarget(value, face({ x: 0.0078, width: 0.04 }), 100, "mono_360_eqr", camera)
    expect(value.target?.yaw).toBeCloseTo(170, 0)
    setPanoramaTarget(value, face({ x: 0.9522, width: 0.04 }), 580, "mono_360_eqr", camera)
    expect(value.target?.yaw).toBeGreaterThan(170)
    expect(value.target?.yaw).toBeLessThan(190)
  })

  it("resets target smoothing after a long detection gap or mode change", () => {
    const value = state()
    setViewportTarget(value, face({ x: 0 }), 100)
    setViewportTarget(value, face({ x: 0.7 }), 2000)
    expect(value.target?.x).toBeCloseTo(0.3)
    const camera = new PerspectiveCamera(80, 1)
    setPanoramaTarget(value, face({ x: 0.2 }), 2100, "mono_360_eqr", camera)
    expect(value.target?.mode).toBe("panorama")
    expect(value.target?.yaw).toBeCloseTo(72)
  })
})
