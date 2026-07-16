import { describe, expect, it } from "vitest"
import { advancePanoramaRecovery, createPanoramaRecoveryScan, getActivePanoramaRecoveryTile, requestPanoramaRefinement } from "../../src/features/vr/tracking/face-detection-state"

const tiles = Array.from({ length: 5 }, (_, index) => ({ yaw: index * 30, pitch: 0, fov: 130 }))

describe("panorama recovery scan", () => {
  it("walks the ordered coarse tiles and completes after the fifth miss", () => {
    const scan = createPanoramaRecoveryScan(tiles)
    const visited = []
    let hasMore = true
    while (hasMore) {
      visited.push(getActivePanoramaRecoveryTile(scan))
      hasMore = advancePanoramaRecovery(scan)
    }
    expect(visited).toEqual(tiles)
  })

  it("allows only one refinement per recovery pass", () => {
    const scan = createPanoramaRecoveryScan(tiles)
    const refinement = { yaw: 12, pitch: 8, fov: 70 }
    expect(requestPanoramaRefinement(scan, refinement)).toBe(true)
    expect(getActivePanoramaRecoveryTile(scan)).toBe(refinement)
    expect(advancePanoramaRecovery(scan)).toBe(true)
    expect(scan.index).toBe(1)
    expect(requestPanoramaRefinement(scan, refinement)).toBe(false)
  })

  it("caps a five-tile pass with refinement at six inferences", () => {
    const scan = createPanoramaRecoveryScan(tiles)
    const visited = []
    let hasMore = true
    while (hasMore) {
      visited.push(getActivePanoramaRecoveryTile(scan))
      if (visited.length === 1) {
        requestPanoramaRefinement(scan, { yaw: 10, pitch: 5, fov: 70 })
        visited.push(getActivePanoramaRecoveryTile(scan))
      }
      hasMore = advancePanoramaRecovery(scan)
    }
    expect(visited).toHaveLength(6)
  })
})
