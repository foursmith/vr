export type FaceInferenceMode = 'landmarks' | 'detection'

export type NormalizedFace = {
  x: number
  y: number
  width: number
  height: number
  score: number
}

export type FaceInferenceResult = {
  id: number
  type: 'result'
  mode: FaceInferenceMode
  timestamp: number
  faces: NormalizedFace[]
  center?: { x: number; y: number }
  inferenceMs: number
}

export type FaceWorkerRequest =
  | { type: 'init' }
  | {
      id: number
      type: 'infer'
      mode: FaceInferenceMode
      timestamp: number
      bitmap: ImageBitmap
    }

export type FaceWorkerResponse =
  | { type: 'progress'; loaded: number; total: number; label: string }
  | { type: 'ready' }
  | FaceInferenceResult
  | { type: 'error'; id?: number; message: string }
