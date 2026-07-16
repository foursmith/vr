import { createRoot, flush } from "solid-js"
import { describe, expect, it, vi } from "vitest"
import { createAbLoopController } from "../../src/features/player/ab-loop/controller"

const createHarness = () => {
  const video = {
    currentTime: 0,
    paused: false,
    play: vi.fn(() => Promise.resolve()),
  } as unknown as HTMLVideoElement
  let currentTime = 0
  const controller = createAbLoopController({
    getVideo: () => video,
    getScene: () => undefined,
    getMount: () => document.body,
    getDuration: () => 120,
    getFileName: () => "sample.mp4",
    getFrameRate: () => 30,
    getVideoBitRate: () => 4_000_000,
    getSubtitleText: () => "",
    hasSubtitles: () => false,
    hasVideo: () => true,
    setCurrentTime: time => (currentTime = time),
  })
  return { controller, getCurrentTime: () => currentTime, video }
}

const createOwnedHarness = () => {
  let harness!: ReturnType<typeof createHarness>
  const dispose = createRoot((dispose) => {
    harness = createHarness()
    return dispose
  })
  return { ...harness, dispose }
}

describe("ab loop controller", () => {
  it("sets ordered A and B points and clears the previous end when A changes", () => {
    const { controller, dispose, video } = createOwnedHarness()
    video.currentTime = 10
    controller.setStart()
    flush()
    video.currentTime = 18
    controller.setEnd()
    flush()

    expect(controller.loop).toMatchObject({ a: 10, b: 18 })

    video.currentTime = 12
    controller.setStart()
    flush()
    expect(controller.loop).toMatchObject({ a: 12, b: undefined })
    dispose()
  })

  it("rejects a B point that is not after A", () => {
    const { controller, dispose, video } = createOwnedHarness()
    video.currentTime = 10
    controller.setStart()
    flush()
    video.currentTime = 8
    controller.setEnd()
    flush()

    expect(controller.loop).toMatchObject({ a: 10, b: undefined })
    dispose()
  })

  it("jumps back to A when playback reaches B", () => {
    const { controller, dispose, getCurrentTime, video } = createOwnedHarness()
    video.currentTime = 4
    controller.setStart()
    flush()
    video.currentTime = 9
    controller.setEnd()
    flush()

    expect(controller.syncPlaybackTime(8.9)).toBe(false)
    expect(controller.syncPlaybackTime(9)).toBe(true)
    expect(video.currentTime).toBe(4)
    expect(getCurrentTime()).toBe(4)
    dispose()
  })

  it("resets loop and export status together", () => {
    const { controller, dispose, video } = createOwnedHarness()
    video.currentTime = 3
    controller.setStart()
    flush()
    controller.reset()
    flush()

    expect(controller.loop).toMatchObject({ a: undefined, b: undefined })
    expect(controller.exportState).toMatchObject({ status: "idle", progress: 0, message: undefined })
    dispose()
  })
})
