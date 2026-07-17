import type { FaceDetectorBackend, FaceDetectorService } from "../detection/face-detector-service"
import type { FaceAutoCenterState } from "./face-target-tracking"
import { PerspectiveCamera } from "three"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createFaceScanController } from "./face-scan-controller"

const createDeferred = <T>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

const createFaceState = (): FaceAutoCenterState => ({
  faces: [],
  detectionMode: "viewport",
  nextDetectionAt: 0,
  lastDetectionAt: 0,
  isMoving: false,
  yawVelocity: 0,
  pitchVelocity: 0,
  forwardVelocity: 0,
  lastErrorAt: 0,
})

const createHarness = (detect: FaceDetectorBackend["detect"]) => {
  const faceState = createFaceState()
  const camera = new PerspectiveCamera(80, 1)
  const view = { yaw: 0, pitch: 0, forward: 0 }
  const sampleCanvas = document.createElement("canvas")
  const context = { drawImage: vi.fn() } as unknown as CanvasRenderingContext2D
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context)
  const backend = { detect, destroy: vi.fn() }
  const detector: FaceDetectorService = {
    ensure: vi.fn(async () => backend),
    isReady: () => true,
    release: vi.fn(),
    destroy: vi.fn(),
  }
  const captureViewport = vi.fn((canvas: HTMLCanvasElement) => {
    canvas.width = 320
    canvas.height = 180
    return { width: 320, height: 180 }
  })
  const capturePanoramaTile = vi.fn((canvas: HTMLCanvasElement) => {
    canvas.width = 320
    canvas.height = 320
    return { width: 320, height: 320 }
  })
  const controller = createFaceScanController({
    video: { paused: false } as HTMLVideoElement,
    camera,
    faceState,
    detector,
    sampleCanvas,
    capture: { captureViewport, capturePanoramaTile },
    getProjection: () => "mono_360_eqr",
    getFrameRate: () => 60,
    getView: () => view,
    getSurfaceDistance: () => 100,
    isDebugEnabled: () => false,
    canAcceptResult: () => true,
    requestRender: vi.fn(),
  })
  return { camera, controller, faceState, view }
}

describe("face scan controller", () => {
  beforeEach(() => vi.restoreAllMocks())
  afterEach(() => vi.restoreAllMocks())

  it("maps viewport results with the camera context frozen at capture time", async () => {
    const pending = createDeferred<Array<{
      boundingBox: { x: number, y: number, width: number, height: number }
      score: number
    }>>()
    const detect = vi.fn(() => pending.promise)
    const { camera, controller, faceState, view } = createHarness(detect)

    expect(controller.runDueInference(100)).toBe(true)
    view.yaw = 50
    view.pitch = 20
    view.forward = 12
    camera.aspect = 2
    camera.fov = 40
    camera.updateProjectionMatrix()
    pending.resolve([{
      boundingBox: { x: 224, y: 51, width: 32, height: 18 },
      score: 0.9,
    }])

    await vi.waitFor(() => expect(faceState.target).toBeDefined())
    expect(faceState.target?.yaw).toBeCloseTo(-22.76, 1)
    expect(faceState.target?.pitch).toBeCloseTo(0, 5)
    expect(faceState.target?.forward).not.toBe(12)
    controller.destroy()
  })

  it("starts recovery backoff when the final failed inference completes", async () => {
    let clock = 0
    vi.spyOn(performance, "now").mockImplementation(() => clock)
    const detect = vi.fn(async () => [])
    const { controller, faceState } = createHarness(detect)
    const runInference = async (startedAt: number, completedAt = startedAt) => {
      faceState.nextDetectionAt = 0
      clock = completedAt
      expect(controller.runDueInference(startedAt)).toBe(true)
      await vi.waitFor(() => expect(controller.snapshot().inFlight).toBe(false))
    }

    for (let index = 0; index < 7; index += 1) {
      await runInference(index * 10)
    }
    await runInference(300, 900)

    expect(controller.snapshot().detectionState).toMatchObject({
      phase: "recovery-backoff",
      retryAt: 1400,
    })
    controller.destroy()
  })
})
