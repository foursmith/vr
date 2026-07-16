import type { FaceAutoCenterState, FaceBox, FaceTarget } from "./face-target-tracking"
import { PerspectiveCamera } from "three"
import { describe, expect, it } from "vitest"
import { MIN_FACE_CONFIDENCE } from "../detection/protocol"
import { constrainFaceAutoCenterView, estimateFaceCenteringDuration, FACE_CENTER_EDGE_MARGIN_DEGREES, FACE_CENTER_FORWARD_ACTIVATION_DISTANCE, FACE_CENTER_FORWARD_MAX_SPEED, FACE_CENTER_FORWARD_SETTLE_DISTANCE, FACE_CENTER_MAX_FORWARD, FACE_CENTER_PANORAMA_ACTIVATION_DEGREES, FACE_CENTER_PANORAMA_MAX_SPEED, FACE_CENTER_PANORAMA_SETTLE_DEGREES, FACE_CENTER_SIZE_DEAD_ZONE, FACE_CENTER_STOP_SPEED, FACE_CENTER_TARGET_SIZE, FACE_CENTER_VIEWPORT_ACTIVATION_THRESHOLD, FACE_CENTER_VIEWPORT_MAX_SPEED, FACE_CENTER_VIEWPORT_SETTLE_THRESHOLD, getFaceCenteringError, getFaceCenteringPlan, getFaceCenteringVelocity, getFaceForwardTarget, getFaceForwardVelocity, getFaceMovementHint, getManualZoomForwardTarget, getProjectionCoverageMargin, getProjectionYawLimit, smoothFaceCenteringVelocity } from "./face-center-movement"
import { applyDetections, FACE_CENTER_MANUAL_INPUT_RESUME_DELAY_MS, FACE_DIRECTION_MAX_AGE_MS, FACE_IDENTITY_SWITCH_POSITION_SPEED, FACE_IDENTITY_SWITCH_SIZE_SPEED, getFaceAutoCenterManualResumeAt, getFaceCenter, getPredictedFaceDirection, mapSampleFaceToPanorama, pauseFaceAutoCenter, resumeFaceAutoCenter, setPanoramaTarget, setViewportTarget, updateFaceMotion } from "./face-target-tracking"

const state = (): FaceAutoCenterState => ({
  faces: [],
  detectionMode: "viewport",
  nextDetectionAt: 0,
  lastDetectionAt: 0,
  isMoving: false,
  yawVelocity: 0,
  pitchVelocity: 0,
  forwardVelocity: 0,
  lastErrorAt: 0,
})
const face = (overrides: Partial<FaceBox> = {}): FaceBox => ({ x: 0.2, y: 0.1, width: 0.2, height: 0.3, score: 0.9, lastSeenAt: 10, ...overrides })
const target = (overrides: Partial<FaceTarget> = {}): FaceTarget => ({
  x: 0,
  y: 0,
  mode: "viewport",
  lastSeenAt: 100,
  ...overrides,
})

describe("face auto-center", () => {
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

  it("plans a distant depth target at the reachable 180-degree boundary", () => {
    const camera = new PerspectiveCamera(80, 9 / 16)
    const current = { yaw: -1, pitch: -21, forward: -35 }
    const plan = getFaceCenteringPlan(
      target({ x: 0, y: 0, size: 0.2, forward: -250 }),
      camera,
      current,
      "sbs_180_eqr",
    )

    expect(plan.blockedAxis).toBe("forward")
    expect(plan.targetView.forward).toBeLessThan(current.forward)
    expect(plan.targetView.forward).toBeGreaterThan(plan.desiredView.forward)
    expect(getProjectionCoverageMargin("sbs_180_eqr", camera, plan.targetView)).toBeGreaterThanOrEqual(-0.01)
    expect(plan.error.forwardOffset).toBeCloseTo(plan.targetView.forward - current.forward)
  })

  it("includes the minimum inward recovery needed by a panorama direction in the same plan", () => {
    const camera = new PerspectiveCamera(80, 9 / 16)
    const current = { yaw: 0, pitch: 0, forward: -95 }
    const plan = getFaceCenteringPlan(
      target({ mode: "panorama", yaw: 30, pitch: 0 }),
      camera,
      current,
      "sbs_180_fe",
    )

    expect(plan.targetView.forward).toBeGreaterThan(current.forward)
    expect(plan.error.forwardOffset).toBeGreaterThan(0)
    expect(getProjectionCoverageMargin("sbs_180_fe", camera, plan.targetView)).toBeGreaterThanOrEqual(-0.01)
  })

  it("reports a constrained plan as blocked only after reaching its reachable endpoint", () => {
    const camera = new PerspectiveCamera(80, 9 / 16)
    const targetFace = target({ x: 0, y: 0, size: 0.2, forward: -250 })
    const movingPlan = getFaceCenteringPlan(targetFace, camera, { yaw: 0, pitch: -20, forward: -35 }, "sbs_180_eqr")
    const settledPlan = getFaceCenteringPlan(targetFace, camera, movingPlan.targetView, "sbs_180_eqr")

    expect(movingPlan.error.needsMovement).toBe(true)
    expect(settledPlan.blockedAxis).toBe("forward")
    expect(settledPlan.error.needsMovement).toBe(false)
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
    const smallFace = face({ width: 0.05, height: 0.05 })
    const largeFace = face({ width: FACE_CENTER_TARGET_SIZE * 2, height: FACE_CENTER_TARGET_SIZE * 2 })

    expect(FACE_CENTER_TARGET_SIZE).toBe(0.18)
    expect(FACE_CENTER_SIZE_DEAD_ZONE).toBe(0.02)
    expect(getFaceForwardTarget(smallFace, 0, 100)).toBe(FACE_CENTER_MAX_FORWARD)
    expect(getFaceForwardTarget(largeFace, 0, 100)).toBe(-100)
    expect(getFaceForwardTarget(face({ width: FACE_CENTER_TARGET_SIZE * 4, height: FACE_CENTER_TARGET_SIZE * 4 }), -100, 100)).toBe(-700)
    expect(getFaceForwardTarget(face({ width: FACE_CENTER_TARGET_SIZE, height: FACE_CENTER_TARGET_SIZE }), 0, 100)).toBeCloseTo(0)
    expect(getFaceForwardTarget(face({ width: 0.199, height: 0.199 }), 7, 100)).toBe(7)
    expect(getFaceForwardTarget(face({ width: 0.2, height: 0.2 }), 7, 100)).not.toBe(7)
    expect(getFaceForwardTarget(face({ width: 0.16, height: 0.16 }), 7, 100)).not.toBe(7)
    expect(getFaceForwardTarget(face({ width: 0.201, height: 0.201 }), 7, 100)).not.toBe(7)

    setViewportTarget(value, smallFace, 100, camera, { yaw: 0, pitch: 0, forward: 0 }, undefined, 100)
    expect(value.target?.forward).toBe(FACE_CENTER_MAX_FORWARD)
    const centeredTarget = { ...value.target!, x: 0, y: 0, yaw: 0, pitch: 0 }
    expect(getFaceCenteringError({ ...centeredTarget, forward: FACE_CENTER_FORWARD_ACTIVATION_DISTANCE - 0.01 }, camera, { yaw: 0, pitch: 0, forward: 0 }).needsMovement).toBe(false)
    expect(getFaceCenteringError({ ...centeredTarget, forward: FACE_CENTER_FORWARD_ACTIVATION_DISTANCE + 0.01 }, camera, { yaw: 0, pitch: 0, forward: 0 }).needsMovement).toBe(true)
    expect(getFaceCenteringError({ ...centeredTarget, forward: FACE_CENTER_FORWARD_SETTLE_DISTANCE + 0.01 }, camera, { yaw: 0, pitch: 0, forward: 0 }, true).needsMovement).toBe(true)
    expect(getFaceCenteringError({ ...centeredTarget, size: 0.199, forward: FACE_CENTER_MAX_FORWARD }, camera, { yaw: 0, pitch: 0, forward: 0 }).needsMovement).toBe(false)
    expect(getFaceCenteringError({ ...centeredTarget, size: 0.201, forward: FACE_CENTER_MAX_FORWARD }, camera, { yaw: 0, pitch: 0, forward: 0 }).needsMovement).toBe(true)
    expect(getFaceMovementHint({
      yaw: 0,
      pitch: 0,
      forward: 2.1,
      yawOffset: 0,
      pitchOffset: 0,
      forwardOffset: 0.6,
      needsMovement: true,
    })).toMatchObject({ text: "nearer 0.6", depthValue: "0.6" })
    const settlingState = state()
    setViewportTarget(settlingState, smallFace, 100, camera, { yaw: 0, pitch: 0, forward: 0 }, undefined, 100)
    setViewportTarget(settlingState, face({ width: 0.18, height: 0.18 }), 200, camera, { yaw: 0, pitch: 0, forward: 4 }, undefined, 100)
    expect(settlingState.target).toMatchObject({ size: 0.18, forward: 4 })
    expect(getFaceForwardVelocity(20)).toBeGreaterThan(0)
    expect(getFaceForwardVelocity(20)).toBeLessThan(FACE_CENTER_FORWARD_MAX_SPEED)
    expect(getFaceForwardVelocity(-20)).toBeCloseTo(-getFaceForwardVelocity(20))
    expect(camera.zoom).toBe(1)
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

  it("estimates concurrent automatic movement duration from the active velocity model", () => {
    const stopped = { yaw: 0, pitch: 0, forward: 0 }
    const shortDuration = estimateFaceCenteringDuration(
      { yawOffset: 5, pitchOffset: 0, forwardOffset: 0 },
      stopped,
      "viewport",
    )
    const longDuration = estimateFaceCenteringDuration(
      { yawOffset: 20, pitchOffset: 8, forwardOffset: 12 },
      stopped,
      "viewport",
    )

    expect(estimateFaceCenteringDuration({ yawOffset: 0, pitchOffset: 0, forwardOffset: 0 }, stopped, "viewport")).toBe(0)
    expect(shortDuration).toBeGreaterThan(0)
    expect(longDuration).toBeGreaterThan(shortDuration)
    expect(smoothFaceCenteringVelocity(
      FACE_CENTER_STOP_SPEED / 2,
      FACE_CENTER_STOP_SPEED / 2,
      16,
    )).toBe(0)
    expect(smoothFaceCenteringVelocity(1, FACE_CENTER_STOP_SPEED / 2, 16)).toBeGreaterThan(0)
  })

  it("maps manual zoom scale to unbounded distance-relative camera movement", () => {
    expect(getManualZoomForwardTarget(5, 1, 100)).toBe(5)
    expect(getManualZoomForwardTarget(0, 2, 100)).toBe(50)
    expect(getManualZoomForwardTarget(0, 0.5, 100)).toBe(-100)
    expect(getManualZoomForwardTarget(50, 2, 100)).toBe(75)
    expect(getManualZoomForwardTarget(0, Number.POSITIVE_INFINITY, 100)).toBe(100)
    expect(getManualZoomForwardTarget(0, 0, 100)).toBeLessThan(-1e10)
  })

  it("smooths face movement and detects a receding subject", () => {
    const value = state()
    updateFaceMotion(value, face({ x: 0.4, y: 0.3, width: 0.3, height: 0.4 }), 100)
    const motion = updateFaceMotion(value, face({ x: 0.5, y: 0.3, width: 0.2, height: 0.3 }), 600)
    expect(motion.speed).toBeGreaterThan(0)
    expect(motion.recedingSpeed).toBeGreaterThan(0)
    expect(motion.size).toBeCloseTo(Math.sqrt(0.06))
  })

  it("tracks world direction across the 360-degree seam and predicts ahead", () => {
    const value = state()
    const camera = new PerspectiveCamera(80, 1)
    const centered = face({ x: 0.4, y: 0.4, width: 0.2, height: 0.2 })
    updateFaceMotion(value, centered, 100, camera, { yaw: 170, pitch: 0 })
    const motion = updateFaceMotion(value, centered, 600, camera, { yaw: -170, pitch: 0 })
    const predicted = getPredictedFaceDirection(value, 700, "mono_360_eqr")

    expect(motion.worldYawVelocity).toBeGreaterThan(0)
    expect(predicted?.yaw).toBeGreaterThan(-170)
    expect(predicted?.yaw).toBeLessThan(-150)
  })

  it("removes camera rotation from the observed face direction", () => {
    const value = state()
    const camera = new PerspectiveCamera(80, 1)
    const centered = face({ x: 0.4, y: 0.4, width: 0.2, height: 0.2 })
    const compensatedCenterX = (1 - Math.tan(-10 * Math.PI / 180) / Math.tan(40 * Math.PI / 180)) / 2
    const shifted = face({ x: compensatedCenterX - 0.1, y: 0.4, width: 0.2, height: 0.2 })

    updateFaceMotion(value, centered, 100, camera, { yaw: 0, pitch: 0 })
    const motion = updateFaceMotion(value, shifted, 600, camera, { yaw: 10, pitch: 0 })

    expect(motion.worldYaw).toBeCloseTo(0)
    expect(motion.worldYawVelocity).toBeCloseTo(0)
  })

  it("drops stale direction predictions and clamps 180-degree predictions", () => {
    const value = state()
    value.motion = {
      centerX: 0.5,
      centerY: 0.5,
      size: 0.2,
      speed: 0.2,
      recedingSpeed: 0,
      lastSeenAt: 100,
      worldYaw: 80,
      worldPitch: 70,
      worldYawVelocity: 100,
      worldPitchVelocity: 100,
      directionSamples: 3,
    }

    expect(getPredictedFaceDirection(value, 200, "m_180_eqr")).toEqual({ yaw: 86, pitch: 85 })
    expect(getPredictedFaceDirection(value, 100 + FACE_DIRECTION_MAX_AGE_MS + 1, "m_180_eqr")).toBeUndefined()
  })

  it("holds manual view changes until portrait centering is explicitly resumed", () => {
    const value = state()
    value.faces = [face()]
    value.selectedFace = { ...face(), mode: "viewport" }
    value.target = { x: 0.2, y: -0.1, mode: "viewport", lastSeenAt: 100 }
    value.motion = { centerX: 0.3, centerY: 0.25, size: 0.2, speed: 1, recedingSpeed: 0, lastSeenAt: 100 }
    value.isMoving = true
    value.yawVelocity = 2
    value.forwardVelocity = 4

    pauseFaceAutoCenter(value)

    expect(value).toMatchObject({ manuallyPaused: true, faces: [], isMoving: false, yawVelocity: 0, forwardVelocity: 0 })
    expect(value.target).toBeUndefined()
    expect(value.motion).toBeUndefined()
    expect(value.nextDetectionAt).toBe(Number.POSITIVE_INFINITY)

    resumeFaceAutoCenter(value)
    expect(value.manuallyPaused).toBe(false)
    expect(value.nextDetectionAt).toBe(0)
  })

  it("resumes manual view pauses after one second only when enabled", () => {
    expect(getFaceAutoCenterManualResumeAt(250, false)).toBe(Number.POSITIVE_INFINITY)
    expect(getFaceAutoCenterManualResumeAt(250, true)).toBe(250 + FACE_CENTER_MANUAL_INPUT_RESUME_DELAY_MS)
    expect(FACE_CENTER_MANUAL_INPUT_RESUME_DELAY_MS).toBe(1000)
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
    expect(MIN_FACE_CONFIDENCE).toBe(0.6)
    expect(applyDetections(value, [face({ score: 0.59 })], 300, "viewport")).toBeUndefined()
    expect(applyDetections(value, [face({ score: 0.6 })], 400, "viewport")).toBeDefined()
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
    const camera = new PerspectiveCamera(80, 16 / 9)
    expect(setViewportTarget(value, face(), 100, camera, { yaw: 0, pitch: 0, forward: 0 })).toBe(true)
    expect(value.target?.mode).toBe("viewport")
    expect(value.target?.x).toBeCloseTo(-0.2)
    expect(setPanoramaTarget(value, face({ x: -1, width: 0.1 }), 200, "sbs_180_eqr", camera)).toBe(true)
    expect(value.target?.yaw).toBe(86)
    expect(setViewportTarget(value, undefined, 300, camera, { yaw: 0, pitch: 0, forward: 0 })).toBe(false)
  })

  it("stores viewport detections as absolute targets that converge without rescanning", () => {
    const value = state()
    const camera = new PerspectiveCamera(80, 9 / 16)
    const initialView = { yaw: 20, pitch: -10, forward: 0 }
    setViewportTarget(
      value,
      face({ x: 0.75, y: 0.6, width: 0.1, height: 0.1 }),
      100,
      camera,
      initialView,
    )

    const initialPlan = getFaceCenteringPlan(value.target!, camera, initialView, "mono_360_eqr")
    expect(initialPlan.error.needsMovement).toBe(true)
    const settledPlan = getFaceCenteringPlan(value.target!, camera, {
      ...initialView,
      yaw: value.target!.yaw!,
      pitch: value.target!.pitch!,
      forward: value.target!.forward!,
    }, "mono_360_eqr", true)
    expect(settledPlan.error.yawOffset).toBe(0)
    expect(settledPlan.error.pitchOffset).toBe(0)
    expect(settledPlan.error.needsMovement).toBe(false)
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
    const camera = new PerspectiveCamera(80, 1)
    const view = { yaw: 0, pitch: 0, forward: 0 }
    setViewportTarget(value, face({ x: 0 }), 100, camera, view)
    setViewportTarget(value, face({ x: 0.7 }), 2000, camera, view)
    expect(value.target?.x).toBeCloseTo(0.3)
    setPanoramaTarget(value, face({ x: 0.2 }), 2100, "mono_360_eqr", camera)
    expect(value.target?.mode).toBe("panorama")
    expect(value.target?.yaw).toBeCloseTo(72)
  })
})
