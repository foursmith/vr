import type { CameraView } from "../../src/features/vr/config"
import type { FaceAutoCenterState, FaceTarget } from "../../src/features/vr/tracking/face-target-tracking"
import { PerspectiveCamera } from "three"
import { describe, expect, it } from "vitest"
import { advanceFaceMovement, getFaceCenteringPlan } from "../../src/features/vr/tracking/face-center-movement"

const createState = (): FaceAutoCenterState => ({
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

const createView = (overrides: Partial<CameraView> = {}): CameraView => ({
  yaw: 0,
  pitch: 0,
  zoom: 1,
  forward: 0,
  pausedUntil: 0,
  ...overrides,
})

const createTarget = (overrides: Partial<FaceTarget> = {}): FaceTarget => ({
  x: 0,
  y: 0,
  mode: "panorama",
  lastSeenAt: 100,
  ...overrides,
})

describe("face movement step", () => {
  it("starts a fresh movement and reports its initial duration and hint", () => {
    const state = createState()
    const view = createView()
    const camera = new PerspectiveCamera(80, 9 / 16)
    state.target = createTarget({ yaw: 30, pitch: 20, forward: 10 })

    const result = advanceFaceMovement({
      now: 100,
      delta: 1 / 60,
      state,
      view,
      projection: "mono_360_eqr",
      camera,
    })

    expect(result.started).toBe(true)
    expect(result.stopped).toBe(false)
    expect(result.movementDurationMs).toBeGreaterThan(0)
    expect(result.hint).toMatchObject({
      horizontal: { direction: "right" },
      vertical: { direction: "up" },
      depth: "nearer",
    })
    expect(result.settledBoundaryAxis).toBeUndefined()
    expect(state.offCenterSince).toBe(100)
    expect(state.isMoving).toBe(true)
    expect(view.yaw).toBeGreaterThan(0)
    expect(view.pitch).toBeGreaterThan(0)
    expect(view.forward).toBeGreaterThan(0)
  })

  it("keeps the first off-center timestamp and clears it only after settling", () => {
    const state = createState()
    const view = createView()
    const camera = new PerspectiveCamera(80, 9 / 16)
    state.target = createTarget({ yaw: 30 })

    advanceFaceMovement({ now: 100, delta: 1 / 60, state, view, projection: "mono_360_eqr", camera })
    advanceFaceMovement({ now: 200, delta: 1 / 60, state, view, projection: "mono_360_eqr", camera })
    expect(state.offCenterSince).toBe(100)

    state.target = createTarget({ yaw: view.yaw, pitch: view.pitch, forward: view.forward, lastSeenAt: 200 })
    const result = advanceFaceMovement({ now: 200, delta: 1 / 60, state, view, projection: "mono_360_eqr", camera })

    expect(result.stopped).toBe(true)
    expect(result.hint).toBeUndefined()
    expect(state.offCenterSince).toBeUndefined()
  })

  it("brakes a stale moving target using the longer movement grace period", () => {
    const state = createState()
    const view = createView()
    const camera = new PerspectiveCamera(80, 9 / 16)
    state.target = createTarget({ yaw: 30, lastSeenAt: 0 })
    state.isMoving = true
    state.yawVelocity = 0.01
    state.offCenterSince = 20

    const result = advanceFaceMovement({
      now: 4501,
      delta: 1 / 60,
      state,
      view,
      projection: "mono_360_eqr",
      camera,
    })

    expect(result).toMatchObject({
      hint: undefined,
      started: false,
      stopped: true,
      movementDurationMs: 0,
    })
    expect(state.isMoving).toBe(false)
    expect(state.yawVelocity).toBe(0)
    expect(state.offCenterSince).toBe(20)
  })

  it("zeros blocked velocity and reports the settled projection boundary", () => {
    const state = createState()
    const camera = new PerspectiveCamera(80, 9 / 16)
    const target = createTarget({ mode: "viewport", size: 0.2, forward: -250 })
    const reachable = getFaceCenteringPlan(
      target,
      camera,
      createView({ pitch: -20, forward: -35 }),
      "sbs_180_eqr",
    ).targetView
    const view = createView(reachable)
    state.target = target
    state.isMoving = true
    state.forwardVelocity = -4

    const result = advanceFaceMovement({
      now: 100,
      delta: 1 / 60,
      state,
      view,
      projection: "sbs_180_eqr",
      camera,
    })

    expect(result.stopped).toBe(true)
    expect(result.settledBoundaryAxis).toBe("forward")
    expect(state.forwardVelocity).toBe(0)
    expect(state.isMoving).toBe(false)
  })
})
