/// <reference lib="webworker" />

import { MIN_FACE_CONFIDENCE } from "./protocol"

interface NormalizedFace { x: number, y: number, width: number, height: number, score: number }
type FaceDetectionRange = "short" | "full"
interface FaceInferenceResult {
  id: number
  type: "result"
  timestamp: number
  faces: NormalizedFace[]
  inferenceMs: number
}
type FaceWorkerRequest
  = | { type: "init" }
    | { id: number, type: "infer", detectionRange: FaceDetectionRange, timestamp: number, bitmap: ImageBitmap }
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
const WASM_URL = "/mediapipe/tasks-vision/wasm"
const VISION_WASM_FILESET = {
  wasmLoaderPath: `${WASM_URL}/vision_wasm_internal.js`,
  wasmBinaryPath: `${WASM_URL}/vision_wasm_internal.wasm`,
}
const FULL_RANGE_FACE_MODEL_URL = "/models/face_detector/blaze_face_full_range.tflite"
const SHORT_RANGE_FACE_MODEL_URL = "/models/face_detector/blaze_face_short_range.tflite"

const workerScope = globalThis as unknown as DedicatedWorkerGlobalScope
let fullRangeDetector: FaceDetectorBackend | undefined
let shortRangeDetector: FaceDetectorBackend | undefined
let visionTasks: typeof import("@mediapipe/tasks-vision") | undefined
let initializationPromise: Promise<void> | undefined
let fullRangeDetectorPromise: Promise<FaceDetectorBackend> | undefined
let shortRangeDetectorPromise: Promise<FaceDetectorBackend> | undefined

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
    minDetectionConfidence: MIN_FACE_CONFIDENCE,
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
  try {
    const detector = await getDetector(request.detectionRange)
    post({
      id: request.id,
      type: "result",
      timestamp: request.timestamp,
      faces: readDetectedFaces(detector, request.bitmap),
      inferenceMs: performance.now() - startedAt,
    })
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
