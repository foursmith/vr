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
    })
    const client = createMediaPipeFaceDetectorClient()

    await expect(client.detect({} as HTMLCanvasElement, "short")).resolves.toEqual([
      { boundingBox: { x: 80, y: 36, width: 160, height: 72 } },
    ])
    expect(mocks.infer).toHaveBeenCalledWith("detection", bitmap, expect.any(Number), "short")

    client.destroy()
    expect(mocks.release).toHaveBeenCalledOnce()
  })
})
