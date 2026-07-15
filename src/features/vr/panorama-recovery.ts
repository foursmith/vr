import type { PanoramaScanTile } from "./face-sampling"

export interface PanoramaRecoveryScan {
  tiles: PanoramaScanTile[]
  index: number
  refinement?: PanoramaScanTile
  refinementUsed: boolean
}

export const createPanoramaRecoveryScan = (tiles: PanoramaScanTile[]): PanoramaRecoveryScan => ({
  tiles,
  index: 0,
  refinementUsed: false,
})

export const getActivePanoramaRecoveryTile = (scan: PanoramaRecoveryScan) =>
  scan.refinement ?? scan.tiles[scan.index]

export const requestPanoramaRefinement = (
  scan: PanoramaRecoveryScan,
  tile: PanoramaScanTile,
) => {
  if (scan.refinement || scan.refinementUsed) return false
  scan.refinement = tile
  scan.refinementUsed = true
  return true
}

export const advancePanoramaRecovery = (scan: PanoramaRecoveryScan) => {
  scan.refinement = undefined
  if (scan.index + 1 >= scan.tiles.length) return false
  scan.index += 1
  return true
}
