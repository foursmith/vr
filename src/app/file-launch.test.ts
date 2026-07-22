import { afterEach, describe, expect, it, vi } from "vitest"
import { setupFileLaunchHandler } from "./file-launch"

describe("file launch handling", () => {
  afterEach(() => {
    delete window.launchQueue
  })

  it("imports files delivered by the installed PWA launch queue", async () => {
    let consumer: ((params: { files: FileSystemFileHandle[] }) => void) | undefined
    window.launchQueue = {
      setConsumer: nextConsumer => (consumer = nextConsumer),
    }
    const file = new File(["video"], "movie.mp4", { type: "video/mp4" })
    const importFiles = vi.fn()
    setupFileLaunchHandler({ importFiles, isDisposed: () => false })

    consumer?.({ files: [{ getFile: async () => file } as FileSystemFileHandle] })
    await vi.waitFor(() => expect(importFiles).toHaveBeenCalledWith([file]))
  })

  it("ignores an older launch that resolves after a newer one", async () => {
    let consumer: ((params: { files: FileSystemFileHandle[] }) => void) | undefined
    window.launchQueue = {
      setConsumer: nextConsumer => (consumer = nextConsumer),
    }
    const first = Promise.withResolvers<File>()
    const latest = new File(["latest"], "latest.mkv", { type: "video/matroska" })
    const importFiles = vi.fn()
    setupFileLaunchHandler({ importFiles, isDisposed: () => false })

    consumer?.({ files: [{ getFile: () => first.promise } as FileSystemFileHandle] })
    consumer?.({ files: [{ getFile: async () => latest } as FileSystemFileHandle] })
    await vi.waitFor(() => expect(importFiles).toHaveBeenCalledWith([latest]))
    first.resolve(new File(["first"], "first.mp4", { type: "video/mp4" }))
    await Promise.resolve()

    expect(importFiles).toHaveBeenCalledTimes(1)
  })
})
