import { createRoot, flush } from "solid-js"
import { describe, expect, it, vi } from "vitest"
import { DEFAULT_GLOBAL_PREFERENCES } from "../playback-state"
import { createPlaybackController } from "./playback"

const createHarness = () => {
  const video = {
    currentSrc: "blob:video",
    currentTime: 10,
    duration: 100,
    muted: false,
    paused: true,
    playbackRate: 1,
    play: vi.fn(() => Promise.resolve()),
    pause: vi.fn(),
    volume: 1,
  } as unknown as HTMLVideoElement
  const controller = createRoot(() => createPlaybackController({
    getVideo: () => video,
    hideControls: vi.fn(),
    initialPreferences: DEFAULT_GLOBAL_PREFERENCES,
    openVideoFile: vi.fn(),
    persistActiveVideo: vi.fn(),
    registerPlaybackActivity: vi.fn(),
    resourcesReady: () => true,
    syncTime: vi.fn(),
  }))
  return { controller, video }
}

describe("playback seeking", () => {
  it("starts playback immediately after a timeline seek", () => {
    const { controller, video } = createHarness()
    controller.setDuration(100)
    flush()
    controller.seekTo(48)
    expect(video.currentTime).toBe(48)
    expect(video.play).toHaveBeenCalledOnce()
  })

  it("starts playback immediately after a relative seek", () => {
    const { controller, video } = createHarness()
    controller.seekBy(15)
    expect(video.currentTime).toBe(25)
    expect(video.play).toHaveBeenCalledOnce()
  })
})
