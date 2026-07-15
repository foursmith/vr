export type FaceDetectionRange = "short" | "full"
export const MIN_FACE_CONFIDENCE = 0.6

export interface NormalizedFace {
  x: number
  y: number
  width: number
  height: number
  score: number
}

export interface FaceInferenceResult {
  id: number
  type: "result"
  timestamp: number
  faces: NormalizedFace[]
  inferenceMs: number
}

export type FaceWorkerRequest
  = | { type: "init" }
    | {
      id: number
      type: "infer"
      detectionRange: FaceDetectionRange
      timestamp: number
      bitmap: ImageBitmap
    }

export type FaceWorkerResponse
  = | { type: "progress", loaded: number, total: number, label: string }
    | { type: "ready" }
    | FaceInferenceResult
    | { type: "error", id?: number, message: string }
