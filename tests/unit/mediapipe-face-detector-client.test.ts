import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createMediaPipeFaceDetectorClient } from "../../src/mediapipe-face-detector-client"

const mocks = vi.hoisted(() => ({
  infer: vi.fn(),
  release: vi.fn(),
}))

vi.mock("../../src/features/face-tracking/client", () => ({
  getFaceTrackerClient: () => ({ infer: mocks.infer }),
  releaseFaceAutoCenterResources: mocks.release,
}))

describe("mediaPipe face detector client", () => {
  beforeEach(() => {
    mocks.infer.mockReset()
    mocks.release.mockReset()
  })

  afterEach(() => vi.unstubAllGlobals())

  it("maps normalized MediaPipe boxes back to sample pixels and releases resources", async () => {
    const bitmap = { width: 320, height: 180, close: vi.fn() } as unknown as ImageBitmap
    vi.stubGlobal("createImageBitmap", vi.fn(async () => bitmap))
    mocks.infer.mockResolvedValue({
      faces: [{ x: 0.25, y: 0.2, width: 0.5, height: 0.4, score: 0.9 }],
      center: { x: 0.46, y: 0.37 },
    })
    const client = createMediaPipeFaceDetectorClient()

    await expect(client.detect({} as HTMLCanvasElement, "short")).resolves.toEqual([
      {
        boundingBox: { x: 80, y: 36, width: 160, height: 72 },
        center: { x: 147.20000000000002, y: 66.6 },
        pose: undefined,
        score: 0.9,
      },
    ])
    expect(mocks.infer).toHaveBeenCalledWith("detection", bitmap, expect.any(Number), "short")

    client.destroy()
    expect(mocks.release).toHaveBeenCalledOnce()
  })

  it("requests landmarks and preserves face pose", async () => {
    const bitmap = { width: 200, height: 100, close: vi.fn() } as unknown as ImageBitmap
    vi.stubGlobal("createImageBitmap", vi.fn(async () => bitmap))
    mocks.infer.mockResolvedValue({
      faces: [{
        x: 0.1,
        y: 0.2,
        width: 0.3,
        height: 0.4,
        score: 1,
        pose: { yaw: 12, pitch: -4, roll: 7 },
      }],
      center: { x: 0.25, y: 0.38 },
    })
    const client = createMediaPipeFaceDetectorClient()

    await expect(client.detect({} as HTMLCanvasElement, "short", "landmarks")).resolves.toEqual([{
      boundingBox: { x: 20, y: 20, width: 60, height: 40 },
      center: { x: 50, y: 38 },
      pose: { yaw: 12, pitch: -4, roll: 7 },
      score: 1,
    }])
    expect(mocks.infer).toHaveBeenCalledWith("landmarks", bitmap, expect.any(Number), "short")
  })
})
