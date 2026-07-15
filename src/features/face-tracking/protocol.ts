export type FaceInferenceMode = "landmarks" | "detection"
export type FaceDetectionRange = "short" | "full"
export const MIN_FACE_CONFIDENCE = 0.6
export interface FacePose {
  yaw: number
  pitch: number
  roll: number
}

export interface NormalizedFace {
  x: number
  y: number
  width: number
  height: number
  score: number
  pose?: FacePose
}

export interface FaceInferenceResult {
  id: number
  type: "result"
  mode: FaceInferenceMode
  timestamp: number
  faces: NormalizedFace[]
  center?: { x: number, y: number }
  inferenceMs: number
}

export type FaceWorkerRequest
  = | { type: "init" }
    | {
      id: number
      type: "infer"
      mode: FaceInferenceMode
      detectionRange: FaceDetectionRange
      timestamp: number
      bitmap: ImageBitmap
    }

export type FaceWorkerResponse
  = | { type: "progress", loaded: number, total: number, label: string }
    | { type: "ready" }
    | FaceInferenceResult
    | { type: "error", id?: number, message: string }
