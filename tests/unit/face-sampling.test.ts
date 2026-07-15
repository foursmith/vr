import type { FaceAutoCenterState } from "../../src/features/vr/face-auto-center"
import { PerspectiveCamera } from "three"
import { describe, expect, it, vi } from "vitest"
import {
  drawPanoramaInferenceSample,
  drawSampleBoxes,
  drawViewportInferenceSample,
  getPanoramaScanTile,
  getPanoramaScanTileCount,
  getViewportInferenceSampleSize,
} from "../../src/features/vr/face-sampling"

describe("face sampling", () => {
  it("covers 360-degree projections with three wide horizontal directions and two caps", () => {
    expect(getPanoramaScanTileCount("mono_360_eqr")).toBe(5)
    expect([0, 1, 2].map(index => getPanoramaScanTile("mono_360_eqr", index, 170, 30).yaw)).toEqual([170, -70, 50])
    expect(getPanoramaScanTile("mono_360_eqr", 0, 170, 30)).toMatchObject({ pitch: 30, fov: 130 })
    expect(getPanoramaScanTile("mono_360_eqr", 3, 170, 30).pitch).toBe(70)
    expect(getPanoramaScanTile("mono_360_eqr", 4, 170, 30).pitch).toBe(-70)
  })

  it("prioritizes the lost 180-degree view before scanning the half-sphere", () => {
    expect(getPanoramaScanTileCount("m_180_eqr")).toBe(5)
    expect([0, 1, 2].map(index => getPanoramaScanTile("m_180_eqr", index, 80, -30).yaw)).toEqual([80, -60, 60])
    expect(getPanoramaScanTile("m_180_eqr", 0, 80, -30)).toMatchObject({ pitch: -30, fov: 130 })
    expect(getPanoramaScanTile("m_180_eqr", 3, 80, -30).pitch).toBe(70)
    expect(getPanoramaScanTile("m_180_eqr", 4, 80, -30).pitch).toBe(-70)
  })

  it("preserves aspect ratio and enforces minimum dimensions", () => {
    expect(getViewportInferenceSampleSize(1920, 1080, 320)).toEqual({ width: 320, height: 180 })
    expect(getViewportInferenceSampleSize(4000, 500, 100)).toEqual({ width: 160, height: 120 })
    expect(getViewportInferenceSampleSize(0, 1080, 320)).toBeUndefined()
  })

  it("downscales a viewport into the reusable inference canvas", () => {
    const context = { drawImage: vi.fn() } as unknown as CanvasRenderingContext2D
    const canvas = { width: 1, height: 1 } as HTMLCanvasElement
    const source = {} as HTMLCanvasElement
    const size = drawViewportInferenceSample(canvas, context, source, 100, 50, 1920, 1080, 320)

    expect(size).toEqual({ width: 320, height: 180 })
    expect(canvas).toMatchObject({ width: 320, height: 180 })
    expect(context.drawImage).toHaveBeenCalledWith(source, 100, 50, 1920, 1080, 0, 0, 320, 180)
  })

  it("refuses to sample videos without a current frame", () => {
    const context = { drawImage: vi.fn() } as unknown as CanvasRenderingContext2D
    const video = { videoWidth: 1920, videoHeight: 1080, readyState: HTMLMediaElement.HAVE_METADATA } as HTMLVideoElement
    const result = drawPanoramaInferenceSample(
      { width: 0, height: 0 } as HTMLCanvasElement,
      context,
      video,
      320,
      "mono_360_eqr",
      { yaw: 0, pitch: 0, zoom: 1, pausedUntil: 0 },
      new PerspectiveCamera(80, 16 / 9),
    )
    expect(result).toBeUndefined()
    expect(context.drawImage).not.toHaveBeenCalled()
  })

  it.each([
    ["sbs_180_eqr", 960 * (20 / 180), 960 * (140 / 180), 1080],
    ["tb_360_eqr", 1920 * (110 / 360), 1920 * (140 / 360), 540],
    ["flat_2d", 1920 * (110 / 360), 1920 * (140 / 360), 1080],
  ] as const)("uses the correct source crop for %s", (projection, sourceX, sourceWidth, sourceHeight) => {
    const context = { drawImage: vi.fn() } as unknown as CanvasRenderingContext2D
    const canvas = { width: 0, height: 0 } as HTMLCanvasElement
    const video = { videoWidth: 1920, videoHeight: 1080, readyState: HTMLMediaElement.HAVE_CURRENT_DATA } as HTMLVideoElement
    const sample = drawPanoramaInferenceSample(
      canvas,
      context,
      video,
      320,
      projection,
      { yaw: 0, pitch: 0, zoom: 1, pausedUntil: 0 },
      new PerspectiveCamera(80, 16 / 9),
    )
    expect(sample).toBeDefined()
    expect(context.drawImage).toHaveBeenCalled()
    const args = vi.mocked(context.drawImage).mock.calls[0]
    expect(args[1]).toBeCloseTo(sourceX)
    expect(args[3]).toBeCloseTo(sourceWidth)
    expect(args[4]).toBeCloseTo(sourceHeight)
  })

  it("splits a wrapped 360-degree sample into two source slices", () => {
    const context = { drawImage: vi.fn() } as unknown as CanvasRenderingContext2D
    const canvas = { width: 0, height: 0 } as HTMLCanvasElement
    const video = { videoWidth: 2000, videoHeight: 1000, readyState: HTMLMediaElement.HAVE_CURRENT_DATA } as HTMLVideoElement
    const sample = drawPanoramaInferenceSample(
      canvas,
      context,
      video,
      320,
      "mono_360_eqr",
      { yaw: -179, pitch: 0, zoom: 1, pausedUntil: 0 },
      new PerspectiveCamera(80, 16 / 9),
    )
    expect(sample?.wraps).toBe(true)
    expect(context.drawImage).toHaveBeenCalledTimes(2)
    const [first, second] = vi.mocked(context.drawImage).mock.calls
    expect(first[1]).toBeGreaterThan(0)
    expect(second[1]).toBe(0)
    expect(Number(first[7]) + Number(second[7])).toBeCloseTo(canvas.width)
  })

  it("caps tall panorama samples at the inference height limit", () => {
    const context = { drawImage: vi.fn() } as unknown as CanvasRenderingContext2D
    const canvas = { width: 0, height: 0 } as HTMLCanvasElement
    const video = { videoWidth: 200, videoHeight: 2000, readyState: HTMLMediaElement.HAVE_CURRENT_DATA } as HTMLVideoElement
    drawPanoramaInferenceSample(
      canvas,
      context,
      video,
      640,
      "mono_360_eqr",
      { yaw: 0, pitch: 75, zoom: 1, pausedUntil: 0 },
      new PerspectiveCamera(80, 1),
    )
    expect(canvas.height).toBe(384)
    expect(canvas.width).toBeGreaterThan(0)
    expect(canvas.width).toBeLessThan(640)
  })

  it("drops stale boxes and draws fresh detections", () => {
    const context = { save: vi.fn(), restore: vi.fn(), fillRect: vi.fn(), fillText: vi.fn(), strokeRect: vi.fn() } as unknown as CanvasRenderingContext2D
    const value = {
      faces: [
        { x: 0.1, y: 0.2, width: 0.3, height: 0.4, score: 0.91, lastSeenAt: 900 },
        { x: 0, y: 0, width: 1, height: 1, score: 1, lastSeenAt: 0 },
      ],
    } as FaceAutoCenterState
    drawSampleBoxes(value, { width: 200, height: 100 } as HTMLCanvasElement, context, 1500, "viewport")
    expect(value.faces).toHaveLength(1)
    expect(context.strokeRect).toHaveBeenCalledWith(20, 20, 60, 40)
    expect(context.fillText).toHaveBeenCalledWith("91%", 25, 15)
  })
})
