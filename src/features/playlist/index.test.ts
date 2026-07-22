import { createRoot, flush } from "solid-js"
import { describe, expect, it, vi } from "vitest"
import { createPlaylistController } from "."

describe("playlist imports", () => {
  it("queues imports while playing and switches to the next import while paused", async () => {
    const loadVideoFile = vi.fn()
    let playing = true
    let disposeRoot!: () => void
    const controller = createRoot((dispose) => {
      disposeRoot = dispose
      return createPlaylistController({
        cancelPendingVideoSwitch: vi.fn(),
        canImportLocalMedia: () => true,
        getFileInput: () => document.createElement("input"),
        getFolderInput: () => document.createElement("input"),
        getLastPlaybackKey: () => undefined,
        getVideoPlaybackKey: resource => resource.name,
        isRemoteSourceConnected: () => false,
        isDisposed: () => false,
        isPlaying: () => playing,
        loadRemoteEntries: async () => [],
        loadVideoFile,
        loadVideoUrl: vi.fn(),
        resetCurrentVideo: vi.fn(),
        showControls: vi.fn(),
      })
    })
    const current = new File(["current"], "current.mp4", { type: "video/mp4" })
    const queued = new File(["queued"], "queued.mkv", { type: "video/matroska" })
    const resumed = new File(["resumed"], "resumed.mp4", { type: "video/mp4" })

    await controller.importNodes([{ id: "current", name: current.name, kind: "video", file: current }])
    await controller.importNodes([{ id: "queued", name: queued.name, kind: "video", file: queued }])
    playing = false
    await controller.importNodes([{ id: "resumed", name: resumed.name, kind: "video", file: resumed }])
    flush()

    expect(controller.nodes().map(node => node.id)).toEqual(["current", "queued", "resumed"])
    expect(loadVideoFile).toHaveBeenCalledOnce()
    expect(loadVideoFile).toHaveBeenCalledWith(resumed, "resumed")
    disposeRoot()
  })
})
