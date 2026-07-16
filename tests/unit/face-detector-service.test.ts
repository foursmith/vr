import type { FaceDetectorBackend } from "../../src/features/vr/detection/face-detector-service"
import { describe, expect, it, vi } from "vitest"
import { createFaceDetectorService } from "../../src/features/vr/detection/face-detector-service"

const createBackend = (): FaceDetectorBackend => ({
  detect: vi.fn(async () => []),
  destroy: vi.fn(),
})

const createDeferred = <T>() => {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

describe("face detector service", () => {
  it("coalesces concurrent initialization and reuses the ready backend", async () => {
    const backend = createBackend()
    const loadBackend = vi.fn(async () => backend)
    const service = createFaceDetectorService(loadBackend)

    const first = service.ensure()
    const second = service.ensure()

    expect(first).toBe(second)
    await expect(first).resolves.toBe(backend)
    await expect(service.ensure()).resolves.toBe(backend)
    expect(loadBackend).toHaveBeenCalledOnce()
    expect(service.isReady()).toBe(true)
  })

  it("invalidates and destroys an initialization superseded by release", async () => {
    const firstLoad = createDeferred<FaceDetectorBackend>()
    const secondLoad = createDeferred<FaceDetectorBackend>()
    const firstBackend = createBackend()
    const secondBackend = createBackend()
    const loadBackend = vi.fn()
      .mockReturnValueOnce(firstLoad.promise)
      .mockReturnValueOnce(secondLoad.promise)
    const service = createFaceDetectorService(loadBackend)

    const firstEnsure = service.ensure()
    service.release()
    const secondEnsure = service.ensure()

    firstLoad.resolve(firstBackend)
    await expect(firstEnsure).rejects.toThrow("Face detector initialization was superseded")
    expect(firstBackend.destroy).toHaveBeenCalledOnce()

    secondLoad.resolve(secondBackend)
    await expect(secondEnsure).resolves.toBe(secondBackend)
    expect(service.isReady()).toBe(true)
    expect(secondBackend.destroy).not.toHaveBeenCalled()
  })

  it("destroys the active backend and permanently rejects initialization after destroy", async () => {
    const backend = createBackend()
    const loadBackend = vi.fn(async () => backend)
    const service = createFaceDetectorService(loadBackend)

    await service.ensure()
    service.destroy()
    service.destroy()

    expect(backend.destroy).toHaveBeenCalledOnce()
    expect(service.isReady()).toBe(false)
    await expect(service.ensure()).rejects.toThrow("Face detector service was destroyed")
    expect(loadBackend).toHaveBeenCalledOnce()
  })
})
