import type { PlayerController } from "../../src/features/player/controller"
import { render } from "@solidjs/web"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { PlaybackTimeline } from "../../src/components/player/PlaybackTimeline"

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    disconnect() {}
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.replaceChildren()
})

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
        loadingState: { resourcesReady: false, progress: 42, label: "Loading face detection", error: undefined },
        progress: vi.fn(() => 10),
        seekTo: vi.fn(),
        setAbEnd: vi.fn(),
        setAbStart: vi.fn(),
      },
    } as unknown as PlayerController
    const host = document.createElement("div")
    document.body.append(host)
    const dispose = render(() => <PlaybackTimeline controller={controller} />, host)

    expect(host.textContent).toContain("Loading face detection")
    expect(host.textContent).toContain("42%")
    expect(host.textContent).not.toContain("movie.mp4")
    expect(host.querySelector("[role='progressbar']")?.getAttribute("aria-valuenow")).toBe("42")
    expect(host.querySelector("input")).toBeNull()
    expect(host.querySelector("button")).toBeNull()

    dispose()
  })

  it("blocks AB export for clips longer than one minute", () => {
    const exportAbLoop = vi.fn()
    const controller = {
      controls: {
        registerActivity: vi.fn(),
        setControlsHold: vi.fn(),
      },
      playback: {
        abExport: { status: "idle", progress: 0, message: undefined },
        abExportFormatSupported: vi.fn(() => true),
        abLoop: { a: 10, b: 71 },
        clearAbLoop: vi.fn(),
        currentTime: vi.fn(() => 12),
        duration: vi.fn(() => 120),
        exportAbLoop,
        fileName: vi.fn(() => "movie.mp4"),
        loadingPercent: vi.fn(() => 100),
        loadingState: { resourcesReady: true, progress: 100, label: "Ready", error: undefined },
        progress: vi.fn(() => 10),
        seekTo: vi.fn(),
        setAbEnd: vi.fn(),
        setAbStart: vi.fn(),
      },
    } as unknown as PlayerController
    const host = document.createElement("div")
    document.body.append(host)
    const dispose = render(() => <PlaybackTimeline controller={controller} />, host)

    expect(host.textContent).not.toContain("movie.mp4")
    const exportButton = host.querySelector<HTMLButtonElement>("button[aria-label='AB clip is longer than 1 minute']")!
    expect(exportButton.disabled).toBe(true)
    expect(exportButton.textContent).toContain("1:00 max")
    expect(host.querySelectorAll("button[aria-label='AB clip is longer than 1 minute']")).toHaveLength(3)
    exportButton.click()
    expect(exportAbLoop).not.toHaveBeenCalled()

    dispose()
  })

  it("places retry next to the loading error", () => {
    const startInitialLoad = vi.fn()
    const controller = {
      controls: {
        registerActivity: vi.fn(),
        setControlsHold: vi.fn(),
      },
      playback: {
        loadingPercent: vi.fn(() => 42),
        loadingState: { resourcesReady: false, progress: 42, label: "Try again", error: "Couldn’t get the player ready" },
        startInitialLoad,
      },
    } as unknown as PlayerController
    const host = document.createElement("div")
    document.body.append(host)
    const dispose = render(() => <PlaybackTimeline controller={controller} />, host)

    const status = host.querySelector<HTMLElement>("[role='status']")!
    const retryButton = status.nextElementSibling as HTMLButtonElement
    expect(status.textContent).toBe("Couldn’t get the player ready")
    expect(retryButton.textContent).toBe("Retry")
    retryButton.click()
    expect(startInitialLoad).toHaveBeenCalledOnce()

    dispose()
  })
})
