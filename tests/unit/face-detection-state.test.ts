import { describe, expect, it } from "vitest"
import { acceptFaceDetection, applyPanoramaDetectionMiss, applyViewportDetection, createFaceDetectionState, getActivePanoramaScan, getFaceDetectionMode, getFaceDetectionRange, getFaceDetectionRetryAt, getPanoramaRecoveryRetryDelay, prepareFaceDetection } from "../../src/features/vr/tracking/face-detection-state"

const tiles = [
  { yaw: 0, pitch: 0, fov: 100 },
  { yaw: 90, pitch: 0, fov: 100 },
]

describe("face detection state", () => {
  it("cascades from short viewport tracking to full-range retry and panorama scan", () => {
    let state = createFaceDetectionState()
    expect(state.phase).toBe("tracking")
    expect(getFaceDetectionMode(state)).toBe("viewport")
    expect(getFaceDetectionRange(state)).toBe("short")

    const firstMiss = applyViewportDetection(state, false, () => tiles)
    state = firstMiss.state
    expect(firstMiss.preserveSchedule).toBe(true)
    expect(state).toMatchObject({ phase: "viewport-retry", misses: 1 })
    expect(getFaceDetectionRange(state)).toBe("full")

    const secondMiss = applyViewportDetection(state, false, () => tiles)
    state = secondMiss.state
    expect(secondMiss.preserveSchedule).toBe(false)
    expect(state).toMatchObject({ phase: "panorama-scan", misses: 2 })
    expect(getFaceDetectionMode(state)).toBe("panorama")
    expect(getFaceDetectionRange(state)).toBe("full")
    expect(getActivePanoramaScan(state)?.tiles).toEqual(tiles)
  })

  it("inserts one refinement and backs off after the coarse scan is exhausted", () => {
    let state = applyViewportDetection(
      applyViewportDetection(createFaceDetectionState(), false, () => tiles).state,
      false,
      () => tiles,
    ).state
    const refinement = { yaw: 30, pitch: 10, fov: 70 }

    state = applyPanoramaDetectionMiss(state, 100, refinement)
    expect(getActivePanoramaScan(state)?.refinement).toBe(refinement)
    expect(state.misses).toBe(3)

    state = applyPanoramaDetectionMiss(state, 200)
    expect(state.phase).toBe("panorama-scan")
    expect(getActivePanoramaScan(state)?.index).toBe(1)

    state = applyPanoramaDetectionMiss(state, 300)
    expect(state).toMatchObject({ phase: "recovery-backoff", failedRecoveryPasses: 1, retryAt: 800 })
    expect(getFaceDetectionRetryAt(state)).toBe(800)
    expect(prepareFaceDetection(state, 799)).toBe(state)
    expect(prepareFaceDetection(state, 800)).toMatchObject({ phase: "tracking", failedRecoveryPasses: 1 })
  })

  it("uses capped exponential retry delays and resets them after success", () => {
    expect([0, 1, 2, 3, 4, 5].map(getPanoramaRecoveryRetryDelay)).toEqual([0, 500, 1000, 2000, 4000, 4000])
    expect(acceptFaceDetection()).toEqual(createFaceDetectionState())
    expect(applyViewportDetection({
      phase: "tracking",
      misses: 8,
      failedRecoveryPasses: 3,
    }, true, () => tiles).state).toEqual(createFaceDetectionState())
  })
})
