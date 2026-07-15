/// <reference lib="webworker" />

import { readFacePose } from "./pose"

interface NormalizedLandmark { x: number, y: number }
interface FacePose { yaw: number, pitch: number, roll: number }
interface NormalizedFace { x: number, y: number, width: number, height: number, score: number, pose?: FacePose }
type FaceInferenceMode = "landmarks" | "detection"
type FaceDetectionRange = "short" | "full"
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
    | { id: number, type: "infer", mode: FaceInferenceMode, detectionRange: FaceDetectionRange, timestamp: number, bitmap: ImageBitmap }
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
    facialTransformationMatrixes: Array<{ rows: number, columns: number, data: number[] }>
  }
  close: () => void
}

const WASM_URL = "/mediapipe/tasks-vision/wasm"
const VISION_WASM_FILESET = {
  wasmLoaderPath: `${WASM_URL}/vision_wasm_internal.js`,
  wasmBinaryPath: `${WASM_URL}/vision_wasm_internal.wasm`,
}
const FULL_RANGE_FACE_MODEL_URL = "/models/face_detector/blaze_face_full_range.tflite"
const SHORT_RANGE_FACE_MODEL_URL = "/models/face_detector/blaze_face_short_range.tflite"
const FACE_LANDMARKER_MODEL_URL = "/models/face_landmarker/face_landmarker.task"
const MIN_FACE_SCORE = 0.5

const workerScope = globalThis as unknown as DedicatedWorkerGlobalScope
let fullRangeDetector: FaceDetectorBackend | undefined
let shortRangeDetector: FaceDetectorBackend | undefined
let landmarker: FaceLandmarkerBackend | undefined
let visionTasks: typeof import("@mediapipe/tasks-vision") | undefined
let initializationPromise: Promise<void> | undefined
let fullRangeDetectorPromise: Promise<FaceDetectorBackend> | undefined
let shortRangeDetectorPromise: Promise<FaceDetectorBackend> | undefined
let landmarkerPromise: Promise<FaceLandmarkerBackend> | undefined

const post = (message: FaceWorkerResponse) => workerScope.postMessage(message)

const initialize = () => {
  initializationPromise ??= (async () => {
    const total = 1
    post({ type: "progress", loaded: 0, total, label: "Loading vision runtime" })
    visionTasks = await import("@mediapipe/tasks-vision")
    post({ type: "progress", loaded: total, total, label: "Face worker ready" })
    post({ type: "ready" })
  })()
  return initializationPromise
}

const createDetector = (range: FaceDetectionRange) => {
  const modelAssetPath = range === "short" ? SHORT_RANGE_FACE_MODEL_URL : FULL_RANGE_FACE_MODEL_URL
  return visionTasks!.FaceDetector.createFromOptions(VISION_WASM_FILESET, {
    // Keep inference on the worker CPU so it does not contend with Three.js
    // for the main rendering GPU context.
    baseOptions: { modelAssetPath, delegate: "CPU" },
    runningMode: "IMAGE",
    minDetectionConfidence: MIN_FACE_SCORE,
    minSuppressionThreshold: 0.45,
  }) as Promise<FaceDetectorBackend>
}

const getDetector = async (range: FaceDetectionRange) => {
  await initialize()
  if (range === "short") {
    shortRangeDetectorPromise ??= createDetector("short")
    shortRangeDetector ??= await shortRangeDetectorPromise
    return shortRangeDetector
  }
  fullRangeDetectorPromise ??= createDetector("full")
  fullRangeDetector ??= await fullRangeDetectorPromise
  return fullRangeDetector
}

const getLandmarker = async () => {
  await initialize()
  landmarkerPromise ??= visionTasks!.FaceLandmarker.createFromOptions(VISION_WASM_FILESET, {
    baseOptions: { modelAssetPath: FACE_LANDMARKER_MODEL_URL, delegate: "CPU" },
    runningMode: "VIDEO",
    numFaces: 1,
    minFaceDetectionConfidence: MIN_FACE_SCORE,
    minFacePresenceConfidence: 0.5,
    minTrackingConfidence: 0.55,
    outputFaceBlendshapes: false,
    outputFacialTransformationMatrixes: true,
  }) as Promise<FaceLandmarkerBackend>
  landmarker ??= await landmarkerPromise
  return landmarker
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

const readDetectedFaces = (detector: FaceDetectorBackend, bitmap: ImageBitmap) => detector.detect(bitmap).detections.filter(item => item.boundingBox).map((item) => {
  const box = item.boundingBox!
  return {
    x: box.originX / bitmap.width,
    y: box.originY / bitmap.height,
    width: box.width / bitmap.width,
    height: box.height / bitmap.height,
    score: item.categories[0]?.score ?? 0,
  }
}).sort((a, b) => b.width * b.height - a.width * a.height).slice(0, 8)

const infer = async (request: Extract<FaceWorkerRequest, { type: "infer" }>) => {
  await initialize()
  const startedAt = performance.now()
  let response: FaceInferenceResult
  try {
    if (request.mode === "landmarks") {
      const landmarkBackend = await getLandmarker()
      const landmarkResult = landmarkBackend.detectForVideo(request.bitmap, request.timestamp)
      const landmarks = landmarkResult.faceLandmarks[0]
      const readFace = landmarks ? readLandmarkFace(landmarks) : undefined
      const face = readFace
        ? { ...readFace, pose: readFacePose(landmarkResult.facialTransformationMatrixes[0]) }
        : undefined
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
      const detector = await getDetector(request.detectionRange)
      response = {
        id: request.id,
        type: "result",
        mode: request.mode,
        timestamp: request.timestamp,
        faces: readDetectedFaces(detector, request.bitmap),
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
