import { describe, expect, it } from "vitest"
import { scheduleFrame } from "../../src/features/vr/rendering/render-cadence-policy"
import { FACE_CENTER_MOVING_SCAN_MAX_PERIOD_MS, FACE_CENTER_MOVING_SCAN_MIN_PERIOD_MS, faceInferencePeriod, movingFaceInferencePeriod, shouldRunFaceInference } from "../../src/features/vr/tracking/inference-schedule-policy"

describe("frame scheduler", () => {
  it("holds a stable 24 fps average on a 60 Hz animation clock without drifting to 20 fps", () => {
    let nextFrameAt: number | undefined
    let rendered = 0
    for (let displayFrame = 0; displayFrame < 600; displayFrame += 1) {
      const schedule = scheduleFrame(displayFrame * (1000 / 60), 24, nextFrameAt)
      nextFrameAt = schedule.nextFrameAt
      if (schedule.render) rendered += 1
    }
    expect(rendered).toBeGreaterThanOrEqual(239)
    expect(rendered).toBeLessThanOrEqual(241)
  })

  it.each([
    [24, 24],
    [30, 30],
    [60, 60],
  ])("samples 59.94 fps video frames at a stable %i fps without retrying skipped frames", (targetFrameRate, expectedFrames) => {
    let nextFrameAt: number | undefined
    let rendered = 0
    for (let sourceFrame = 0; sourceFrame < 600; sourceFrame += 1) {
      const mediaTimeMs = sourceFrame * (1000 / 59.94)
      const schedule = scheduleFrame(mediaTimeMs, targetFrameRate, nextFrameAt)
      nextFrameAt = schedule.nextFrameAt
      if (schedule.render) rendered += 1
    }
    expect(rendered).toBeGreaterThanOrEqual(expectedFrames * 9.9)
    expect(rendered).toBeLessThanOrEqual(expectedFrames * 10.1)
  })

  it("skips missed deadlines instead of accumulating a burst of catch-up frames", () => {
    const first = scheduleFrame(0, 30)
    const afterPause = scheduleFrame(1000, 30, first.nextFrameAt)
    expect(afterPause.render).toBe(true)
    expect(afterPause.nextFrameAt).toBeGreaterThan(1000)
    expect(scheduleFrame(1001, 30, afterPause.nextFrameAt).render).toBe(false)
  })

  it("renders immediately after a backward seek resets the playback deadline", () => {
    const beforeSeek = scheduleFrame(915_000, 60)
    expect(scheduleFrame(445_000, 60, beforeSeek.nextFrameAt).render).toBe(false)
    expect(scheduleFrame(445_000, 60).render).toBe(true)
  })

  it("renders interactions at animation-frame cadence without carrying the playback deadline", () => {
    const playback = scheduleFrame(0, 24)
    const interaction = scheduleFrame(10, 24, playback.nextFrameAt, "interaction")

    expect(interaction).toEqual({ render: true })
    expect(scheduleFrame(11, 24, interaction.nextFrameAt)).toEqual({
      render: true,
      nextFrameAt: 11 + 1000 / 24,
    })
  })

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
