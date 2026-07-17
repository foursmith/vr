import type { FaceWorkerResponse } from "./protocol"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { acquireFaceTrackerClient, downloadFaceTrackingResources, FaceTrackerClient, prefetchFaceTrackingResources, releaseFaceAutoCenterResources, releaseFaceTrackerClient } from "./face-tracker-client"

class FakeWorker {
  static instances: FakeWorker[] = []
  onmessage?: (event: MessageEvent<FaceWorkerResponse>) => void
  onerror?: (event: ErrorEvent) => void
  postMessage = vi.fn()
  terminate = vi.fn()

  constructor() {
    FakeWorker.instances.push(this)
  }

  emit(data: FaceWorkerResponse) {
    this.onmessage?.({ data } as MessageEvent<FaceWorkerResponse>)
  }
}

beforeEach(() => {
  FakeWorker.instances = []
  vi.stubGlobal("Worker", FakeWorker)
  vi.stubGlobal("OffscreenCanvas", class {})
  vi.stubGlobal("createImageBitmap", vi.fn())
})

afterEach(() => {
  releaseFaceAutoCenterResources()
  vi.unstubAllGlobals()
})

describe("faceTrackerClient worker backend", () => {
  it("keeps the shared tracker alive until every detector lease is released", async () => {
    const first = acquireFaceTrackerClient()
    const second = acquireFaceTrackerClient()
    expect(second).toBe(first)

    const initializing = first.initialize(() => {})
    const worker = FakeWorker.instances[0]
    worker.emit({ type: "ready" })
    await initializing

    releaseFaceTrackerClient(first)
    expect(worker.terminate).not.toHaveBeenCalled()
    releaseFaceTrackerClient(second)
    expect(worker.terminate).toHaveBeenCalledOnce()
  })

  it("downloads and caches face tracking resources before initialization", async () => {
    const cache = {
      match: vi.fn(async () => undefined),
      put: vi.fn(async () => {}),
      delete: vi.fn(async () => true),
    }
    const open = vi.fn(async () => cache)
    const fetch = vi.fn(async () => new Response("resource"))
    const progress = vi.fn()
    vi.stubGlobal("caches", { open })
    vi.stubGlobal("fetch", fetch)

    await downloadFaceTrackingResources(progress)

    expect(fetch).toHaveBeenCalledTimes(4)
    expect(cache.put).toHaveBeenCalledTimes(4)
    expect(cache.delete).toHaveBeenCalledWith(expect.objectContaining({ url: expect.stringContaining("face_landmarker") }))
    expect(progress).toHaveBeenNthCalledWith(1, { loaded: 0, total: 4, label: "Downloading face tracking resources" })
    expect(progress).toHaveBeenLastCalledWith({ loaded: 4, total: 4, label: "Downloading face tracking resources" })
    expect(fetch).not.toHaveBeenCalledWith(expect.objectContaining({ url: expect.stringContaining("face_landmarker") }))
  })

  it("coalesces background resource prefetches", async () => {
    const cache = {
      match: vi.fn(async () => undefined),
      put: vi.fn(async () => {}),
      delete: vi.fn(async () => true),
    }
    const fetch = vi.fn(async () => new Response("resource"))
    vi.stubGlobal("caches", { open: vi.fn(async () => cache) })
    vi.stubGlobal("fetch", fetch)

    const first = prefetchFaceTrackingResources()
    const second = prefetchFaceTrackingResources()

    expect(first).toBe(second)
    await first
    expect(fetch).toHaveBeenCalledTimes(4)
  })

  it("initializes once, forwards progress and resolves inference results", async () => {
    const client = new FaceTrackerClient()
    const progress = vi.fn()
    const initializing = client.initialize(progress)
    const sameInitialization = client.initialize(progress)
    expect(initializing).toBe(sameInitialization)
    const worker = FakeWorker.instances[0]
    expect(worker.postMessage).toHaveBeenCalledWith({ type: "init" })
    worker.emit({ type: "progress", loaded: 1, total: 2, label: "runtime" })
    worker.emit({ type: "ready" })
    await initializing
    expect(progress).toHaveBeenCalledWith({ type: "progress", loaded: 1, total: 2, label: "runtime" })
    expect(client.getBackendLabel()).toBe("Worker CPU")

    const bitmap = { close: vi.fn() } as unknown as ImageBitmap
    const inference = client.infer(bitmap, 42, "short")
    await Promise.resolve()
    expect(worker.postMessage).toHaveBeenLastCalledWith(
      { id: 1, type: "infer", detectionRange: "short", timestamp: 42, bitmap },
      [bitmap],
    )
    worker.emit({ id: 1, type: "result", timestamp: 42, faces: [], inferenceMs: 3 })
    await expect(inference).resolves.toMatchObject({ id: 1, inferenceMs: 3 })
  })

  it("rejects pending work and terminates the worker when destroyed", async () => {
    const client = new FaceTrackerClient()
    const initializing = client.initialize(() => {})
    const worker = FakeWorker.instances[0]
    worker.emit({ type: "ready" })
    await initializing
    const bitmap = { close: vi.fn() } as unknown as ImageBitmap
    const inference = client.infer(bitmap, 10)
    await Promise.resolve()
    client.destroy()
    await expect(inference).rejects.toThrow("Face tracker was destroyed")
    expect(worker.terminate).toHaveBeenCalledOnce()
    await expect(client.initialize(() => {})).rejects.toThrow("Face tracker was destroyed")
    const lateBitmap = { close: vi.fn() } as unknown as ImageBitmap
    await expect(client.infer(lateBitmap, 20)).rejects.toThrow("Face tracker was destroyed")
    expect(lateBitmap.close).toHaveBeenCalledOnce()
  })

  it("sends strictly increasing timestamps to MediaPipe", async () => {
    const client = new FaceTrackerClient()
    const initializing = client.initialize(() => {})
    const worker = FakeWorker.instances[0]
    worker.emit({ type: "ready" })
    await initializing

    const firstBitmap = { close: vi.fn() } as unknown as ImageBitmap
    const firstInference = client.infer(firstBitmap, 1000)
    await Promise.resolve()
    worker.emit({ id: 1, type: "result", timestamp: 1000, faces: [], inferenceMs: 3 })
    await firstInference

    const secondBitmap = { close: vi.fn() } as unknown as ImageBitmap
    const secondInference = client.infer(secondBitmap, 1000)
    await Promise.resolve()
    expect(worker.postMessage).toHaveBeenLastCalledWith(
      { id: 2, type: "infer", detectionRange: "full", timestamp: 1001, bitmap: secondBitmap },
      [secondBitmap],
    )
    client.destroy()
    await expect(secondInference).rejects.toThrow("Face tracker was destroyed")
  })

  it("rejects inference when posting a transferable bitmap fails", async () => {
    const client = new FaceTrackerClient()
    const initializing = client.initialize(() => {})
    const worker = FakeWorker.instances[0]
    worker.emit({ type: "ready" })
    await initializing
    worker.postMessage.mockImplementationOnce(() => {
      throw new Error("transfer failed")
    })
    const bitmap = { close: vi.fn() } as unknown as ImageBitmap
    await expect(client.infer(bitmap, 1)).rejects.toThrow("transfer failed")
    expect(bitmap.close).toHaveBeenCalledOnce()
    expect(worker.terminate).toHaveBeenCalledOnce()
  })
})
