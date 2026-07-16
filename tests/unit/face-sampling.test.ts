import { describe, expect, it, vi } from "vitest"
import { drawViewportInferenceSample, getRenderViewports, getViewportInferenceSampleSize } from "../../src/features/vr/rendering/vr-render-runtime"
import {
  getPanoramaRefinementTile,
  getPanoramaScanTile,
  getPanoramaScanTileCount,
  getPanoramaScanTiles,
  isPanoramaCandidateReliable,
  PANORAMA_COARSE_TILE_FOV,
  PANORAMA_REFINEMENT_FOV,
} from "../../src/features/vr/tracking/face-sampling"

describe("face sampling", () => {
  it("covers 360-degree projections with six overlapping cubemap-like views", () => {
    expect(PANORAMA_COARSE_TILE_FOV).toBe(100)
    expect(getPanoramaScanTileCount("mono_360_eqr")).toBe(6)
    expect([0, 1, 2, 3].map(index => getPanoramaScanTile("mono_360_eqr", index, 170, 30).yaw)).toEqual([170, -100, -10, 80])
    expect(getPanoramaScanTile("mono_360_eqr", 0, 170, 30)).toMatchObject({ pitch: 0, fov: 100 })
    expect(getPanoramaScanTile("mono_360_eqr", 4, 170, 30).pitch).toBe(90)
    expect(getPanoramaScanTile("mono_360_eqr", 5, 170, 30).pitch).toBe(-90)
  })

  it("covers 180-degree projections without a center gap near edge views", () => {
    expect(getPanoramaScanTileCount("m_180_eqr")).toBe(5)
    expect([0, 1, 2].map(index => getPanoramaScanTile("m_180_eqr", index, 80, -30).yaw)).toEqual([0, -60, 60])
    expect(getPanoramaScanTile("m_180_eqr", 0, 80, -30)).toMatchObject({ pitch: 0, fov: 100 })
    expect(getPanoramaScanTile("m_180_eqr", 3, 80, -30).pitch).toBe(90)
    expect(getPanoramaScanTile("m_180_eqr", 4, 80, -30).pitch).toBe(-90)
  })

  it("keeps the fixed scan order without a reliable motion prediction", () => {
    expect(getPanoramaScanTiles("mono_360_eqr", 0, 10)).toEqual(
      Array.from({ length: 6 }, (_, index) => getPanoramaScanTile("mono_360_eqr", index, 0, 10)),
    )
  })

  it("scans the tile nearest the predicted spherical direction first", () => {
    expect(getPanoramaScanTiles("mono_360_eqr", 0, 0, { yaw: 105, pitch: 0 })[0]).toMatchObject({ yaw: 90, pitch: 0 })
    expect(getPanoramaScanTiles("mono_360_eqr", 0, 0, { yaw: 0, pitch: 75 })[0]).toMatchObject({ yaw: 0, pitch: 90 })
    expect(getPanoramaScanTiles("mono_360_eqr", 170, 0, { yaw: -80, pitch: 0 })[0].yaw).toBe(-100)
    expect(getPanoramaScanTiles("m_180_eqr", 0, 0, { yaw: 75, pitch: 0 })[0].yaw).toBe(60)
  })

  it("accepts centered confident recovery faces and refines weak or edge candidates", () => {
    expect(isPanoramaCandidateReliable({ x: 0.35, y: 0.3, width: 0.2, height: 0.3, score: 0.9 })).toBe(true)
    expect(isPanoramaCandidateReliable({ x: 0.35, y: 0.3, width: 0.2, height: 0.3, score: 0.69 })).toBe(false)
    expect(isPanoramaCandidateReliable({ x: 0.01, y: 0.3, width: 0.2, height: 0.3, score: 0.9 })).toBe(false)
    expect(isPanoramaCandidateReliable({ x: 0.1, y: 0.3, width: 0.1, height: 0.3, score: 0.9 })).toBe(false)
  })

  it("centers a narrow refinement tile on the panorama candidate", () => {
    expect(PANORAMA_REFINEMENT_FOV).toBe(70)
    expect(getPanoramaRefinementTile("mono_360_eqr", {
      x: 0.2,
      y: 0.15,
      width: 0.2,
      height: 0.2,
      score: 0.65,
      lastSeenAt: 100,
    })).toEqual({ yaw: 72, pitch: 45, fov: 70 })
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
})

describe("render viewport layout", () => {
  it("uses one full viewport when split screen is disabled", () => {
    expect(getRenderViewports(1920, 1080, false)).toEqual([
      { x: 0, y: 0, width: 1920, height: 1080 },
    ])
  })

  it("does not split portrait or square output", () => {
    expect(getRenderViewports(800, 1200, true)).toEqual([
      { x: 0, y: 0, width: 800, height: 1200 },
    ])
    expect(getRenderViewports(800, 800, true)).toEqual([
      { x: 0, y: 0, width: 800, height: 800 },
    ])
  })

  it("chooses the largest landscape panel count that preserves a 9:16 minimum aspect", () => {
    expect(getRenderViewports(899, 800, true)).toEqual([
      { x: 0, y: 0, width: 899, height: 800 },
    ])
    expect(getRenderViewports(900, 800, true)).toEqual([
      { x: 0, y: 0, width: 450, height: 800 },
      { x: 450, y: 0, width: 450, height: 800 },
    ])
  })

  it("caps split screen at three equally sized panels", () => {
    expect(getRenderViewports(3840, 1080, true)).toEqual([
      { x: 0, y: 0, width: 1280, height: 1080 },
      { x: 1280, y: 0, width: 1280, height: 1080 },
      { x: 2560, y: 0, width: 1280, height: 1080 },
    ])
  })
})
