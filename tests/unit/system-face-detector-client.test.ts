import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createSystemFaceDetectorWorkerClient } from "../../src/system-face-detector-client"

type WorkerResponse
  = | { type: "ready" }
    | { type: "result", id: number, faces: Array<{ boundingBox: { x: number, y: number, width: number, height: number } }> }
    | { type: "error", id?: number, message: string }

class FakeWorker {
  static instance: FakeWorker
  onmessage?: (event: MessageEvent<WorkerResponse>) => void
  onerror?: (event: ErrorEvent) => void
  postMessage = vi.fn()
  terminate = vi.fn()

  constructor() {
    FakeWorker.instance = this
  }

  emit(data: WorkerResponse) {
    this.onmessage?.({ data } as MessageEvent<WorkerResponse>)
  }
}

describe("system face detector worker client", () => {
  beforeEach(() => {
    vi.stubGlobal("Worker", FakeWorker)
  })

  afterEach(() => vi.unstubAllGlobals())

  it("transfers a bitmap to the worker and resolves detected faces", async () => {
    const bitmap = { close: vi.fn() } as unknown as ImageBitmap
    vi.stubGlobal("createImageBitmap", vi.fn(async () => bitmap))
    const client = createSystemFaceDetectorWorkerClient()
    const worker = FakeWorker.instance
    expect(worker.postMessage).toHaveBeenCalledWith({ type: "init" })
    worker.emit({ type: "ready" })

    const source = {} as HTMLCanvasElement
    const detection = client.detect(source)
    await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledTimes(2))
    expect(worker.postMessage).toHaveBeenLastCalledWith({ type: "detect", id: 1, bitmap }, [bitmap])
    const faces = [{ boundingBox: { x: 1, y: 2, width: 3, height: 4 } }]
    worker.emit({ type: "result", id: 1, faces })

    await expect(detection).resolves.toEqual(faces)
    client.destroy()
    expect(worker.terminate).toHaveBeenCalledOnce()
  })

  it("rejects detection when the worker cannot initialize the system API", async () => {
    vi.stubGlobal("createImageBitmap", vi.fn())
    const client = createSystemFaceDetectorWorkerClient()
    FakeWorker.instance.emit({ type: "error", message: "FaceDetector unavailable" })

    await expect(client.detect({} as HTMLCanvasElement)).rejects.toThrow("FaceDetector unavailable")
    client.destroy()
  })
})
