import { describe, expect, it } from "vitest"
import { scheduleFrame } from "../../src/features/vr/frame-scheduler"

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
})
