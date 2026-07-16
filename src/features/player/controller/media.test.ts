import { afterEach, describe, expect, it, vi } from "vitest"
import { createMediaController } from "./media"

describe("media switching", () => {
  afterEach(() => vi.useRealTimers())

  it("starts the new source without waiting for playback history", () => {
    vi.useFakeTimers()
    const unresolvedHistory = new Promise<undefined>(() => {})
    const load = vi.fn()
    const video = {
      currentSrc: "",
      currentTime: 0,
      duration: Number.NaN,
      paused: true,
      src: "",
      getAttribute(this: { src: string }, name: string) {
        return name === "src" && this.src ? this.src : null
      },
      load,
      pause: vi.fn(),
      play: vi.fn(() => Promise.resolve()),
      removeAttribute(this: { src: string }, name: string) {
        if (name === "src") this.src = ""
      },
    } as unknown as HTMLVideoElement
    const clearMediaFrame = vi.fn()
    const controller = createMediaController({
      clearMediaFrame,
      clearSubtitles: vi.fn(),
      getPlaylistSubtitle: vi.fn(),
      hasPlaylistResource: () => true,
      initializeVideo: vi.fn(),
      isDisposed: () => false,
      loadSubtitle: vi.fn(),
      playbackHistory: {
        activate: () => unresolvedHistory,
        deactivate: vi.fn(),
        persistActive: async () => {},
        persistLast: vi.fn(),
        persistVideo: async () => {},
        scheduleSave: vi.fn(),
        writeLast: vi.fn(),
      },
      resetAbLoop: vi.fn(),
      resetPlayback: vi.fn(),
      resetScene: vi.fn(),
      resetSceneMedia: vi.fn(),
      resetTransientView: vi.fn(),
      restoreProjection: vi.fn(),
      setCurrentTime: vi.fn(),
      setDuration: vi.fn(),
      setFileName: vi.fn(),
      setHasVideo: vi.fn(),
      setPlaying: vi.fn(),
      setSelectedPlaylistId: vi.fn(),
      startInitialIdleCountdown: vi.fn(),
      syncAbLoopTime: () => false,
    })
    controller.setVideo(video)

    controller.loadUrl("https://example.com/next.mp4", "Next")
    vi.runAllTimers()

    expect(video.src).toBe("https://example.com/next.mp4")
    expect(video.play).toHaveBeenCalledOnce()
    expect(clearMediaFrame).toHaveBeenCalledOnce()
    expect(clearMediaFrame.mock.invocationCallOrder[0]).toBeLessThan(load.mock.invocationCallOrder[0])
  })
})
