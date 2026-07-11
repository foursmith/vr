/// <reference lib="webworker" />

interface NormalizedLandmark { x: number, y: number }
interface NormalizedFace { x: number, y: number, width: number, height: number, score: number }
type FaceInferenceMode = "landmarks" | "detection"
interface FaceInferenceResult {
  id: number
  type: "result"
  mode: FaceInferenceMode
  timestamp: number
  faces: NormalizedFace[]
  center?: { x: number, y: number }
  inferenceMs: number
}
type FaceWorkerRequest
  = | { type: "init" }
    | { id: number, type: "infer", mode: FaceInferenceMode, timestamp: number, bitmap: ImageBitmap }
type FaceWorkerResponse
  = | { type: "progress", loaded: number, total: number, label: string }
    | { type: "ready" }
    | FaceInferenceResult
    | { type: "error", id?: number, message: string }
interface FaceDetectorBackend {
  detect: (image: ImageBitmap) => {
    detections: Array<{
      boundingBox?: { originX: number, originY: number, width: number, height: number }
      categories: Array<{ score: number }>
    }>
  }
  close: () => void
}
interface FaceLandmarkerBackend {
  detectForVideo: (image: ImageBitmap, timestamp: number) => {
    faceLandmarks: NormalizedLandmark[][]
  }
  close: () => void
}

const WASM_URL = "/mediapipe/tasks-vision/wasm"
const FACE_MODEL_URL = "/models/face_detector/blaze_face_full_range.tflite"
const FACE_LANDMARKER_MODEL_URL = "/models/face_landmarker/face_landmarker.task"
const MIN_FACE_SCORE = 0.5

const workerScope = globalThis as unknown as DedicatedWorkerGlobalScope
let detector: FaceDetectorBackend | undefined
let landmarker: FaceLandmarkerBackend | undefined
let initializationPromise: Promise<void> | undefined

const post = (message: FaceWorkerResponse) => workerScope.postMessage(message)

const initialize = () => {
  initializationPromise ??= (async () => {
    const total = 3
    post({ type: "progress", loaded: 0, total, label: "Loading vision runtime" })
    const { FaceDetector, FaceLandmarker, FilesetResolver } = await import("@mediapipe/tasks-vision")
    const vision = await FilesetResolver.forVisionTasks(WASM_URL)

    post({ type: "progress", loaded: 1, total, label: "Loading face detector worker" })
    // Keep inference on the worker CPU so it does not contend with Three.js
    // for the main rendering GPU context.
    detector = await FaceDetector.createFromOptions(vision, {
      baseOptions: { modelAssetPath: FACE_MODEL_URL, delegate: "CPU" },
      runningMode: "IMAGE",
      minDetectionConfidence: MIN_FACE_SCORE,
      minSuppressionThreshold: 0.45,
    }) as FaceDetectorBackend

    post({ type: "progress", loaded: 2, total, label: "Loading face landmark worker" })
    landmarker = await FaceLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: FACE_LANDMARKER_MODEL_URL, delegate: "CPU" },
      runningMode: "VIDEO",
      numFaces: 1,
      minFaceDetectionConfidence: MIN_FACE_SCORE,
      minFacePresenceConfidence: 0.5,
      minTrackingConfidence: 0.55,
      outputFaceBlendshapes: false,
      outputFacialTransformationMatrixes: false,
    }) as FaceLandmarkerBackend

    post({ type: "progress", loaded: total, total, label: "Face worker ready" })
    post({ type: "ready" })
  })()
  return initializationPromise
}

const readLandmarkFace = (landmarks: NormalizedLandmark[]): NormalizedFace | undefined => {
  let minX = 1
  let minY = 1
  let maxX = 0
  let maxY = 0
  let validCount = 0
  for (const landmark of landmarks) {
    if (!Number.isFinite(landmark.x) || !Number.isFinite(landmark.y)) continue
    minX = Math.min(minX, landmark.x)
    minY = Math.min(minY, landmark.y)
    maxX = Math.max(maxX, landmark.x)
    maxY = Math.max(maxY, landmark.y)
    validCount += 1
  }
  if (validCount < 24) return undefined

  minX = Math.min(1, Math.max(0, minX))
  minY = Math.min(1, Math.max(0, minY))
  maxX = Math.min(1, Math.max(0, maxX))
  maxY = Math.min(1, Math.max(0, maxY))
  const width = maxX - minX
  const height = maxY - minY
  return width >= 0.02 && height >= 0.02
    ? { x: minX, y: minY, width, height, score: 1 }
    : undefined
}

const readLandmarkCenter = (landmarks: NormalizedLandmark[], fallback: NormalizedFace) => {
  const leftEye = landmarks[33]
  const rightEye = landmarks[263]
  const nose = landmarks[1]
  if (!leftEye || !rightEye || !nose) {
    return { x: fallback.x + fallback.width / 2, y: fallback.y + fallback.height / 2 }
  }
  return {
    x: (leftEye.x + rightEye.x + nose.x * 1.4) / 3.4,
    y: (leftEye.y + rightEye.y + nose.y * 1.4) / 3.4,
  }
}

const infer = async (request: Extract<FaceWorkerRequest, { type: "infer" }>) => {
  await initialize()
  const startedAt = performance.now()
  let response: FaceInferenceResult
  try {
    if (request.mode === "landmarks") {
      const landmarks = landmarker!.detectForVideo(request.bitmap, request.timestamp).faceLandmarks[0]
      const face = landmarks ? readLandmarkFace(landmarks) : undefined
      response = {
        id: request.id,
        type: "result",
        mode: request.mode,
        timestamp: request.timestamp,
        faces: face ? [face] : [],
        center: face && landmarks ? readLandmarkCenter(landmarks, face) : undefined,
        inferenceMs: performance.now() - startedAt,
      }
    } else {
      const detections = detector!.detect(request.bitmap).detections
      const faces = detections
        .filter(item => item.boundingBox)
        .map((item) => {
          const box = item.boundingBox!
          return {
            x: box.originX / request.bitmap.width,
            y: box.originY / request.bitmap.height,
            width: box.width / request.bitmap.width,
            height: box.height / request.bitmap.height,
            score: item.categories[0]?.score ?? 0,
          }
        })
        .sort((a, b) => b.width * b.height - a.width * a.height)
        .slice(0, 8)
      response = {
        id: request.id,
        type: "result",
        mode: request.mode,
        timestamp: request.timestamp,
        faces,
        inferenceMs: performance.now() - startedAt,
      }
    }
    post(response)
  } finally {
    request.bitmap.close()
  }
}

workerScope.onmessage = (event: MessageEvent<FaceWorkerRequest>) => {
  const request = event.data
  if (request.type === "init") {
    void initialize().catch((error) => {
      initializationPromise = undefined
      post({ type: "error", message: error instanceof Error ? error.message : String(error) })
    })
    return
  }

  void infer(request).catch((error) => {
    post({
      type: "error",
      id: request.id,
      message: error instanceof Error ? error.message : String(error),
    })
  })
}
