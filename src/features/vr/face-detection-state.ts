import type { FaceDetectionRange } from "../face-tracking/protocol"
import type { PanoramaScanTile } from "./face-sampling"
import type { PanoramaRecoveryScan } from "./panorama-recovery"
import { advancePanoramaRecovery, createPanoramaRecoveryScan, requestPanoramaRefinement } from "./panorama-recovery"

// Keep doc/PORTRAIT_CENTERING.md synchronized with detection-state transitions.

export const PANORAMA_RECOVERY_RETRY_BASE_MS = 500
export const PANORAMA_RECOVERY_RETRY_MAX_MS = 4000

interface DetectionStateBase {
  misses: number
  failedRecoveryPasses: number
}

export type FaceDetectionState
  = | DetectionStateBase & { phase: "tracking" }
    | DetectionStateBase & { phase: "viewport-retry" }
    | DetectionStateBase & { phase: "panorama-scan", scan: PanoramaRecoveryScan }
    | DetectionStateBase & { phase: "recovery-backoff", retryAt: number }

export interface ViewportDetectionTransition {
  state: FaceDetectionState
  preserveSchedule: boolean
}

export const createFaceDetectionState = (): FaceDetectionState => ({
  phase: "tracking",
  misses: 0,
  failedRecoveryPasses: 0,
})

export const getPanoramaRecoveryRetryDelay = (failedPasses: number) => failedPasses <= 0
  ? 0
  : Math.min(PANORAMA_RECOVERY_RETRY_MAX_MS, PANORAMA_RECOVERY_RETRY_BASE_MS * 2 ** (failedPasses - 1))

export const prepareFaceDetection = (state: FaceDetectionState, now: number): FaceDetectionState =>
  state.phase === "recovery-backoff" && now >= state.retryAt
    ? { phase: "tracking", misses: state.misses, failedRecoveryPasses: state.failedRecoveryPasses }
    : state

export const getFaceDetectionMode = (state: FaceDetectionState) =>
  state.phase === "panorama-scan" ? "panorama" as const : "viewport" as const

export const getFaceDetectionRange = (state: FaceDetectionState): FaceDetectionRange =>
  state.phase === "viewport-retry" || state.phase === "panorama-scan" ? "full" : "short"

export const getFaceDetectionRetryAt = (state: FaceDetectionState) =>
  state.phase === "recovery-backoff" ? state.retryAt : 0

export const getActivePanoramaScan = (state: FaceDetectionState) =>
  state.phase === "panorama-scan" ? state.scan : undefined

export const acceptFaceDetection = (): FaceDetectionState => createFaceDetectionState()

export const applyViewportDetection = (
  state: FaceDetectionState,
  foundFace: boolean,
  createTiles: () => PanoramaScanTile[],
): ViewportDetectionTransition => {
  if (foundFace) return { state: acceptFaceDetection(), preserveSchedule: false }
  const misses = state.misses + 1
  if (state.phase !== "viewport-retry") {
    return {
      state: { phase: "viewport-retry", misses, failedRecoveryPasses: state.failedRecoveryPasses },
      preserveSchedule: true,
    }
  }
  return {
    state: {
      phase: "panorama-scan",
      misses,
      failedRecoveryPasses: state.failedRecoveryPasses,
      scan: createPanoramaRecoveryScan(createTiles()),
    },
    preserveSchedule: false,
  }
}

export const applyPanoramaDetectionMiss = (
  state: FaceDetectionState,
  time: number,
  refinement?: PanoramaScanTile,
): FaceDetectionState => {
  if (state.phase !== "panorama-scan") return state
  const misses = state.misses + 1
  if (refinement && requestPanoramaRefinement(state.scan, refinement)) {
    return { ...state, misses }
  }
  if (advancePanoramaRecovery(state.scan)) return { ...state, misses }
  const failedRecoveryPasses = state.failedRecoveryPasses + 1
  return {
    phase: "recovery-backoff",
    misses,
    failedRecoveryPasses,
    retryAt: time + getPanoramaRecoveryRetryDelay(failedRecoveryPasses),
  }
}
