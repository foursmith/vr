import { describe, expect, it } from "vitest"
import { faceInferencePeriod, scheduleFrame } from "../../src/features/vr/frame-scheduler"

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

  it("skips missed deadlines instead of accumulating a burst of catch-up frames", () => {
    const first = scheduleFrame(0, 30)
    const afterPause = scheduleFrame(1000, 30, first.nextFrameAt)
    expect(afterPause.render).toBe(true)
    expect(afterPause.nextFrameAt).toBeGreaterThan(1000)
    expect(scheduleFrame(1001, 30, afterPause.nextFrameAt).render).toBe(false)
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
    expect(faceInferencePeriod(60, 0, "searching")).toBe(125)
    expect(faceInferencePeriod(60, 0, "recovery")).toBeCloseTo(1000 / 12)
  })

  it("uses measured inference cost as a floor for every activity", () => {
    expect(faceInferencePeriod(60, 100, "stable")).toBeCloseTo(1000 / 3)
    expect(faceInferencePeriod(60, 100, "active")).toBeCloseTo(1000 / 6)
    expect(faceInferencePeriod(60, 100, "recovery")).toBeCloseTo(103)
  })

  it("slows down for a close still face and anticipates fast or receding motion", () => {
    expect(faceInferencePeriod(60, 0, "stable", { size: 0.25, speed: 0.02, recedingSpeed: 0 })).toBe(500)
    expect(faceInferencePeriod(60, 0, "active", { size: 0.12, speed: 0.5, recedingSpeed: 0 })).toBe(100)
    expect(faceInferencePeriod(60, 0, "stable", { size: 0.12, speed: 0.02, recedingSpeed: 0.15 })).toBe(100)
  })
})
