import { describe, expect, it } from "vitest"
import { scheduleFrame } from "./render-cadence-policy"

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
})
