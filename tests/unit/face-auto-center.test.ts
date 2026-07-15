import type { FaceAutoCenterState, FaceBox, FaceTarget } from "../../src/features/vr/face-auto-center"
import { PerspectiveCamera } from "three"
import { describe, expect, it } from "vitest"
import { applyDetections, constrainFaceAutoCenterView, FACE_CENTER_EDGE_MARGIN_DEGREES, FACE_CENTER_FORWARD_ACTIVATION_DISTANCE, FACE_CENTER_FORWARD_MAX_SPEED, FACE_CENTER_FORWARD_SETTLE_DISTANCE, FACE_CENTER_MAX_FORWARD, FACE_CENTER_MIN_FORWARD, FACE_CENTER_PANORAMA_ACTIVATION_DEGREES, FACE_CENTER_PANORAMA_MAX_SPEED, FACE_CENTER_PANORAMA_SETTLE_DEGREES, FACE_CENTER_TARGET_SIZE, FACE_CENTER_VIEWPORT_ACTIVATION_THRESHOLD, FACE_CENTER_VIEWPORT_MAX_SPEED, FACE_CENTER_VIEWPORT_SETTLE_THRESHOLD, FACE_IDENTITY_SWITCH_POSITION_SPEED, FACE_IDENTITY_SWITCH_SIZE_SPEED, FACE_PITCH_LOOK_DEAD_ZONE_DEGREES, FACE_PITCH_LOOK_MAX_VIEWPORT_OFFSET, getFaceCenter, getFaceCenteringError, getFaceCenteringVelocity, getFaceDetectionRange, getFaceForwardTarget, getFaceForwardVelocity, getFaceInferenceMode, getFaceMovementHint, getFacePitchAdjustedCenter, getProjectionCoverageMargin, getProjectionYawLimit, mapSampleFaceToPanorama, pauseFaceAutoCenter, resumeFaceAutoCenter, setPanoramaTarget, setViewportTarget, shouldEnterPanoramaRecovery, updateFaceMotion, VIEWPORT_MISSES_BEFORE_PANORAMA } from "../../src/features/vr/face-auto-center"

const state = (): FaceAutoCenterState => ({
  faces: [],
  detectionMode: "viewport",
  nextDetectionAt: 0,
  lastDetectionAt: 0,
  consecutiveMisses: 0,
  consecutiveViewportMisses: 0,
  isMoving: false,
  yawVelocity: 0,
  pitchVelocity: 0,
  forwardVelocity: 0,
  lastErrorAt: 0,
})
const face = (overrides: Partial<FaceBox> = {}): FaceBox => ({ x: 0.2, y: 0.1, width: 0.2, height: 0.3, score: 0.9, lastSeenAt: 10, ...overrides })

describe("face auto-center", () => {
  it("uses short-range detection for the viewport and full-range detection for panorama recovery", () => {
    expect(getFaceDetectionRange("viewport")).toBe("short")
    expect(getFaceDetectionRange("panorama")).toBe("full")
  })

  it("enters panorama recovery only after two consecutive viewport misses", () => {
    expect(VIEWPORT_MISSES_BEFORE_PANORAMA).toBe(2)
    expect(shouldEnterPanoramaRecovery(1)).toBe(false)
    expect(shouldEnterPanoramaRecovery(2)).toBe(true)
  })

  it("uses landmarks only for a reliable MediaPipe viewport target", () => {
    expect(getFaceInferenceMode("mediapipe", "viewport", true)).toBe("landmarks")
    expect(getFaceInferenceMode("mediapipe", "viewport", false)).toBe("detection")
    expect(getFaceInferenceMode("mediapipe", "panorama", true)).toBe("detection")
    expect(getFaceInferenceMode("system", "viewport", true)).toBe("detection")
  })

  it("follows face pitch vertically without applying yaw or roll", () => {
    const center = { x: 0.4, y: 0.35 }
    expect(getFacePitchAdjustedCenter(center, FACE_PITCH_LOOK_DEAD_ZONE_DEGREES)).toBe(center)
    expect(getFacePitchAdjustedCenter(center, -18)).toEqual({
      x: 0.4,
      y: center.y - FACE_PITCH_LOOK_MAX_VIEWPORT_OFFSET / 2,
    })
    expect(getFacePitchAdjustedCenter(center, 18)).toEqual({
      x: 0.4,
      y: center.y + FACE_PITCH_LOOK_MAX_VIEWPORT_OFFSET / 2,
    })
    expect(getFacePitchAdjustedCenter(center, -90)).toEqual({
      x: 0.4,
      y: 0.35 - FACE_PITCH_LOOK_MAX_VIEWPORT_OFFSET,
    })
    expect(getFacePitchAdjustedCenter(center, 90)).toEqual({
      x: 0.4,
      y: 0.35 + FACE_PITCH_LOOK_MAX_VIEWPORT_OFFSET,
    })
  })

  it("allows a strong face pitch to start vertical centering on its own", () => {
    const camera = new PerspectiveCamera(80, 9 / 16)
    const center = { x: 0.5, y: 1 / 3 }
    const targetForPitch = (pitch: number): FaceTarget => {
      const adjusted = getFacePitchAdjustedCenter(center, pitch)
      return {
        x: adjusted.x - center.x,
        y: adjusted.y - center.y,
        mode: "viewport",
        lastSeenAt: 100,
      }
    }
    const view = { yaw: 0, pitch: 0, forward: 0 }

    expect(getFaceCenteringError(targetForPitch(18), camera, view).needsMovement).toBe(false)
    expect(getFaceCenteringError(targetForPitch(30), camera, view).needsMovement).toBe(true)
  })

  it("computes centers and projection yaw limits", () => {
    expect(getFaceCenter(face()).x).toBeCloseTo(0.3)
    expect(getFaceCenter(face()).y).toBeCloseTo(0.25)
    expect(getProjectionYawLimit("sbs_180_eqr")).toBe(86)
    expect(getProjectionYawLimit("mono_360_eqr")).toBeUndefined()
  })

  it("detects when a 180-degree viewport exposes the projection edge", () => {
    const camera = new PerspectiveCamera(80, 9 / 16)
    const centered = { yaw: 0, pitch: 0, forward: 0 }
    const nearEdge = { yaw: 86, pitch: 0, forward: 0 }

    expect(FACE_CENTER_EDGE_MARGIN_DEGREES).toBe(2)
    expect(getProjectionCoverageMargin("sbs_180_eqr", camera, centered)).toBeGreaterThan(0)
    expect(getProjectionCoverageMargin("sbs_180_eqr", camera, nearEdge)).toBeLessThan(0)
    expect(getProjectionCoverageMargin("mono_360_eqr", camera, nearEdge)).toBe(Number.POSITIVE_INFINITY)
  })

  it("stops automatic movement at the last fully covered 180-degree view", () => {
    const camera = new PerspectiveCamera(80, 9 / 16)
    const current = { yaw: 0, pitch: 20, forward: 10 }
    const proposed = { yaw: 86, pitch: 20, forward: 10 }
    const constrained = constrainFaceAutoCenterView("m_180_eqr", camera, current, proposed)

    expect(constrained.yaw).toBeGreaterThan(0)
    expect(constrained.yaw).toBeLessThan(proposed.yaw)
    expect(getProjectionCoverageMargin("m_180_eqr", camera, constrained)).toBeGreaterThanOrEqual(-0.01)
    expect(constrainFaceAutoCenterView("mono_360_eqr", camera, current, proposed)).toBe(proposed)
  })

  it("allows automatic movement that recovers an already exposed edge", () => {
    const camera = new PerspectiveCamera(80, 9 / 16)
    const current = { yaw: 86, pitch: 0, forward: 0 }
    const proposed = { yaw: 85, pitch: 0, forward: 0 }

    expect(constrainFaceAutoCenterView("sbs_180_fe", camera, current, proposed)).toBe(proposed)
  })

  it("checks the inset curved mask when constraining fisheye movement", () => {
    const camera = new PerspectiveCamera(80, 9 / 16)
    const view = { yaw: 45, pitch: 0, forward: -35 }

    expect(getProjectionCoverageMargin("sbs_180_fe", camera, view))
      .toBeLessThan(getProjectionCoverageMargin("sbs_180_eqr", camera, view))
  })

  it("detects the curved hemisphere boundary near the top and bottom of the viewport", () => {
    const camera = new PerspectiveCamera(80, 9 / 16)
    const level = { yaw: 0, pitch: 0, forward: 0 }
    const nearPole = { yaw: 0, pitch: 50, forward: 0 }

    expect(getProjectionCoverageMargin("m_180_eqr", camera, level)).toBeGreaterThan(0)
    expect(getProjectionCoverageMargin("m_180_eqr", camera, nearPole)).toBeLessThan(0)
  })

  it("uses shared hysteresis thresholds for movement and adaptive scan activity", () => {
    const camera = new PerspectiveCamera(80, 9 / 16)
    const target = (overrides: Partial<FaceTarget>): FaceTarget => ({
      x: 0,
      y: 0,
      mode: "viewport",
      lastSeenAt: 100,
      ...overrides,
    })

    expect(FACE_CENTER_VIEWPORT_ACTIVATION_THRESHOLD).toBe(0.08)
    expect(FACE_CENTER_VIEWPORT_SETTLE_THRESHOLD).toBe(0.05)
    expect(FACE_CENTER_PANORAMA_ACTIVATION_DEGREES).toBe(10)
    expect(FACE_CENTER_PANORAMA_SETTLE_DEGREES).toBe(7)
    const view = { yaw: 0, pitch: 0, forward: 0 }
    expect(getFaceCenteringError(target({ x: FACE_CENTER_VIEWPORT_ACTIVATION_THRESHOLD - 0.001 }), camera, view).needsMovement).toBe(false)
    expect(getFaceCenteringError(target({ x: FACE_CENTER_VIEWPORT_ACTIVATION_THRESHOLD + 0.001 }), camera, view).needsMovement).toBe(true)
    expect(getFaceCenteringError(target({ x: FACE_CENTER_VIEWPORT_SETTLE_THRESHOLD + 0.001 }), camera, view, true).needsMovement).toBe(true)
    expect(getFaceCenteringError(target({ x: FACE_CENTER_VIEWPORT_SETTLE_THRESHOLD - 0.001 }), camera, view, true).needsMovement).toBe(false)
    expect(getFaceCenteringError(target({ mode: "panorama", yaw: FACE_CENTER_PANORAMA_ACTIVATION_DEGREES - 0.1 }), camera, view).needsMovement).toBe(false)
    expect(getFaceCenteringError(target({ mode: "panorama", yaw: FACE_CENTER_PANORAMA_ACTIVATION_DEGREES + 0.1 }), camera, view).needsMovement).toBe(true)
    expect(getFaceCenteringError(target({ mode: "panorama", yaw: FACE_CENTER_PANORAMA_SETTLE_DEGREES + 0.1 }), camera, view, true).needsMovement).toBe(true)
    expect(getFaceCenteringError(target({ mode: "panorama", yaw: FACE_CENTER_PANORAMA_SETTLE_DEGREES - 0.1 }), camera, view, true).needsMovement).toBe(false)
  })

  it("translates the camera forward and backward from face size without changing zoom", () => {
    const value = state()
    const camera = new PerspectiveCamera(80, 9 / 16)
    const smallFace = face({ width: 0.1, height: 0.1 })
    const largeFace = face({ width: 0.6, height: 0.6 })

    expect(getFaceForwardTarget(smallFace, 0, 100)).toBe(FACE_CENTER_MAX_FORWARD)
    expect(getFaceForwardTarget(largeFace, 0, 100)).toBe(FACE_CENTER_MIN_FORWARD)
    expect(getFaceForwardTarget(face({ width: FACE_CENTER_TARGET_SIZE, height: FACE_CENTER_TARGET_SIZE }), 0, 100)).toBeCloseTo(0)

    setViewportTarget(value, smallFace, 100, undefined, 0, 100)
    expect(value.target?.forward).toBe(FACE_CENTER_MAX_FORWARD)
    const centeredTarget = { ...value.target!, x: 0, y: 0 }
    expect(getFaceCenteringError({ ...centeredTarget, forward: FACE_CENTER_FORWARD_ACTIVATION_DISTANCE - 0.01 }, camera, { yaw: 0, pitch: 0, forward: 0 }).needsMovement).toBe(false)
    expect(getFaceCenteringError({ ...centeredTarget, forward: FACE_CENTER_FORWARD_ACTIVATION_DISTANCE + 0.01 }, camera, { yaw: 0, pitch: 0, forward: 0 }).needsMovement).toBe(true)
    expect(getFaceCenteringError({ ...centeredTarget, forward: FACE_CENTER_FORWARD_SETTLE_DISTANCE + 0.01 }, camera, { yaw: 0, pitch: 0, forward: 0 }, true).needsMovement).toBe(true)
    expect(getFaceForwardVelocity(20)).toBeGreaterThan(0)
    expect(getFaceForwardVelocity(20)).toBeLessThan(FACE_CENTER_FORWARD_MAX_SPEED)
    expect(getFaceForwardVelocity(-20)).toBeCloseTo(-getFaceForwardVelocity(20))
    expect(camera.zoom).toBe(1)
  })

  it("describes horizontal, vertical, and forward movement in the debug hint", () => {
    expect(getFaceMovementHint({
      yaw: -14,
      pitch: 9,
      forward: -6.25,
      yawOffset: -4,
      pitchOffset: 2,
      forwardOffset: -3.25,
      needsMovement: true,
    })).toEqual({
      left: 12,
      top: 14,
      text: "← 14° · ↑ 9° · farther 6.3",
      horizontal: { direction: "left", value: "14°" },
      vertical: { direction: "up", value: "9°" },
      depth: "farther",
      depthValue: "6.3",
    })
    expect(getFaceMovementHint({
      yaw: 0,
      pitch: -8,
      forward: 5,
      yawOffset: 0,
      pitchOffset: -1,
      forwardOffset: 2,
      needsMovement: true,
    })).toEqual({
      left: 50,
      top: 86,
      text: "↓ 8° · nearer 5.0",
      horizontal: undefined,
      vertical: { direction: "down", value: "8°" },
      depth: "nearer",
      depthValue: "5.0",
    })
    expect(getFaceMovementHint({
      yaw: 0,
      pitch: 0,
      forward: -4,
      yawOffset: 0,
      pitchOffset: 0,
      forwardOffset: -1,
      needsMovement: true,
    })).toEqual({
      left: 50,
      top: 50,
      text: "farther 4.0",
      horizontal: undefined,
      vertical: undefined,
      depth: "farther",
      depthValue: "4.0",
    })
    expect(getFaceMovementHint({
      yaw: 2,
      pitch: 1,
      forward: 0.5,
      yawOffset: 0,
      pitchOffset: 0,
      forwardOffset: 0,
      needsMovement: false,
    })).toBeUndefined()
  })

  it("accelerates camera movement with target distance and preserves direction", () => {
    const viewportSpeeds = [2, 12, 45].map(offset => getFaceCenteringVelocity(offset, "viewport"))
    const panoramaSpeeds = [2, 30, 120].map(offset => getFaceCenteringVelocity(offset, "panorama"))

    expect(viewportSpeeds[0]).toBeGreaterThan(0)
    expect(viewportSpeeds[0]).toBeLessThan(viewportSpeeds[1])
    expect(viewportSpeeds[1]).toBeLessThan(viewportSpeeds[2])
    expect(viewportSpeeds[2]).toBeLessThan(FACE_CENTER_VIEWPORT_MAX_SPEED)
    expect(panoramaSpeeds[0]).toBeLessThan(panoramaSpeeds[1])
    expect(panoramaSpeeds[1]).toBeLessThan(panoramaSpeeds[2])
    expect(panoramaSpeeds[2]).toBeLessThan(FACE_CENTER_PANORAMA_MAX_SPEED)
    expect(getFaceCenteringVelocity(-30, "panorama")).toBeCloseTo(-panoramaSpeeds[1])
    expect(getFaceCenteringVelocity(0, "viewport")).toBe(0)
  })

  it("smooths face movement and detects a receding subject", () => {
    const value = state()
    updateFaceMotion(value, face({ x: 0.4, y: 0.3, width: 0.3, height: 0.4 }), 100)
    const motion = updateFaceMotion(value, face({ x: 0.5, y: 0.3, width: 0.2, height: 0.3 }), 600)
    expect(motion.speed).toBeGreaterThan(0)
    expect(motion.recedingSpeed).toBeGreaterThan(0)
    expect(motion.size).toBeCloseTo(Math.sqrt(0.06))
  })

  it("holds manual view changes until face centering is explicitly resumed", () => {
    const value = state()
    value.faces = [face()]
    value.selectedFace = { ...face(), mode: "viewport" }
    value.target = { x: 0.2, y: -0.1, mode: "viewport", lastSeenAt: 100 }
    value.motion = { centerX: 0.3, centerY: 0.25, size: 0.2, speed: 1, recedingSpeed: 0, lastSeenAt: 100 }
    value.recoveryMode = "panorama"
    value.consecutiveMisses = 2
    value.consecutiveViewportMisses = 1
    value.isMoving = true
    value.yawVelocity = 2
    value.forwardVelocity = 4

    pauseFaceAutoCenter(value)

    expect(value).toMatchObject({ manuallyPaused: true, faces: [], isMoving: false, yawVelocity: 0, forwardVelocity: 0 })
    expect(value.target).toBeUndefined()
    expect(value.motion).toBeUndefined()
    expect(value.recoveryMode).toBeUndefined()
    expect(value.consecutiveMisses).toBe(0)
    expect(value.consecutiveViewportMisses).toBe(0)
    expect(value.nextDetectionAt).toBe(Number.POSITIVE_INFINITY)

    resumeFaceAutoCenter(value)
    expect(value.manuallyPaused).toBe(false)
    expect(value.nextDetectionAt).toBe(0)
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

  it("starts a new identity when position and size change too quickly together", () => {
    const value = state()
    applyDetections(value, [face({ x: 0.1, y: 0.1, width: 0.2, height: 0.2 })], 100, "viewport")
    value.target = { x: -0.3, y: -0.1, forward: 10, mode: "viewport", lastSeenAt: 100 }
    value.motion = { centerX: 0.2, centerY: 0.2, size: 0.2, speed: 0.2, recedingSpeed: 0.1, lastSeenAt: 100 }
    value.yawVelocity = 5
    value.forwardVelocity = 4
    value.isMoving = true

    const selected = applyDetections(
      value,
      [face({ x: 0.6, y: 0.1, width: 0.4, height: 0.4 })],
      200,
      "viewport",
    )

    expect(FACE_IDENTITY_SWITCH_POSITION_SPEED).toBe(0.8)
    expect(FACE_IDENTITY_SWITCH_SIZE_SPEED).toBe(1.2)
    expect(selected?.x).toBe(0.6)
    expect(value.target).toBeUndefined()
    expect(value.motion).toBeUndefined()
    expect(value).toMatchObject({ yawVelocity: 0, forwardVelocity: 0, isMoving: false })
  })

  it("keeps identity history when only position or only size changes quickly", () => {
    const positionOnly = state()
    applyDetections(positionOnly, [face({ x: 0.1, width: 0.2, height: 0.2 })], 100, "viewport")
    positionOnly.target = { x: -0.3, y: -0.1, mode: "viewport", lastSeenAt: 100 }
    applyDetections(positionOnly, [face({ x: 0.6, width: 0.2, height: 0.2 })], 200, "viewport")
    expect(positionOnly.target).toBeDefined()

    const sizeOnly = state()
    applyDetections(sizeOnly, [face({ x: 0.1, width: 0.2, height: 0.2 })], 100, "viewport")
    sizeOnly.target = { x: -0.3, y: -0.1, mode: "viewport", lastSeenAt: 100 }
    applyDetections(sizeOnly, [face({ x: 0, y: 0, width: 0.4, height: 0.4 })], 200, "viewport")
    expect(sizeOnly.target).toBeDefined()
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
