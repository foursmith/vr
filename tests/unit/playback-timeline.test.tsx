import type { PlayerController } from "../../src/features/player/controller"
import { render } from "@solidjs/web"
import { afterEach, describe, expect, it, vi } from "vitest"
import { PlaybackTimeline } from "../../src/components/player/PlaybackTimeline"

afterEach(() => document.body.replaceChildren())

describe("playback timeline", () => {
  it("replaces all playback metadata while player models load", () => {
    const controller = {
      controls: {
        registerActivity: vi.fn(),
        setControlsHold: vi.fn(),
      },
      playback: {
        abLoop: { a: 10, b: 20 },
        clearAbLoop: vi.fn(),
        currentTime: vi.fn(() => 12),
        duration: vi.fn(() => 120),
        fileName: vi.fn(() => "movie.mp4"),
        loadingPercent: vi.fn(() => 42),
        loadingState: { resourcesReady: false, progress: 42, label: "Loading models", error: undefined },
        progress: vi.fn(() => 10),
        seekTo: vi.fn(),
        setAbEnd: vi.fn(),
        setAbStart: vi.fn(),
      },
    } as unknown as PlayerController
    const host = document.createElement("div")
    document.body.append(host)
    const dispose = render(() => <PlaybackTimeline controller={controller} />, host)

    expect(host.textContent).toContain("Loading models")
    expect(host.textContent).toContain("42%")
    expect(host.textContent).not.toContain("movie.mp4")
    expect(host.querySelector("input")).toBeNull()
    expect(host.querySelector("button")).toBeNull()

    dispose()
  })
})
