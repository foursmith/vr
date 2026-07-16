import { describe, expect, it } from "vitest"
import { FACE_CENTER_MOVING_SCAN_MAX_PERIOD_MS, FACE_CENTER_MOVING_SCAN_MIN_PERIOD_MS, faceInferencePeriod, movingFaceInferencePeriod, shouldRunFaceInference } from "./inference-schedule-policy"

describe("face inference scheduler", () => {
  it("locks short automatic movements and permits scheduled rescans during long movements", () => {
    expect(shouldRunFaceInference(1000, 900, true)).toBe(false)
    expect(shouldRunFaceInference(1000, 900, true, true)).toBe(true)
    expect(shouldRunFaceInference(1000, 900, false)).toBe(true)
    expect(shouldRunFaceInference(899, 900, false)).toBe(false)
    expect(movingFaceInferencePeriod(600, 0)).toBe(FACE_CENTER_MOVING_SCAN_MIN_PERIOD_MS)
    expect(movingFaceInferencePeriod(6000, 0)).toBe(FACE_CENTER_MOVING_SCAN_MAX_PERIOD_MS)
  })

  it.each([
    [24, 1000 / 24],
    [30, 1000 / 30],
    [60, 1000 / 60],
  ])("aligns face inference with a %i fps render target", (frameRate, expectedPeriod) => {
    expect(faceInferencePeriod(frameRate, 0)).toBeCloseTo(expectedPeriod)
  })

  it("slows face inference when processing cannot keep up with the render target", () => {
    expect(faceInferencePeriod(60, 40)).toBeCloseTo(46)
  })

  it("adapts inference frequency to tracking activity", () => {
    expect(faceInferencePeriod(60, 0, "stable")).toBeCloseTo(1000 / 3)
    expect(faceInferencePeriod(60, 0, "active")).toBeCloseTo(1000 / 6)
    expect(faceInferencePeriod(60, 0, "searching")).toBe(200)
    expect(faceInferencePeriod(60, 0, "recovery")).toBeCloseTo(1000 / 6)
  })

  it("uses measured inference cost as a floor for every activity", () => {
    expect(faceInferencePeriod(60, 100, "stable")).toBeCloseTo(1000 / 3)
    expect(faceInferencePeriod(60, 100, "active")).toBeCloseTo(1000 / 6)
    expect(faceInferencePeriod(60, 100, "recovery")).toBeCloseTo(1000 / 6)
  })

  it("slows down for a close still face and anticipates fast or receding motion", () => {
    expect(faceInferencePeriod(60, 0, "stable", { size: 0.25, speed: 0.02, recedingSpeed: 0 })).toBe(500)
    expect(faceInferencePeriod(60, 0, "active", { size: 0.12, speed: 0.5, recedingSpeed: 0 })).toBe(100)
    expect(faceInferencePeriod(60, 0, "stable", { size: 0.12, speed: 0.02, recedingSpeed: 0.15 })).toBe(100)
  })
})
