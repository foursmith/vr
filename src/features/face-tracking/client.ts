import type { FaceDetector, FaceLandmarker, NormalizedLandmark } from "@mediapipe/tasks-vision"
import type {
  FaceDetectionRange,
  FaceInferenceMode,
  FaceInferenceResult,
  FaceWorkerResponse,
  NormalizedFace,
} from "./protocol"

const WASM_URL = "/mediapipe/tasks-vision/wasm"
const VISION_WASM_FILESET = {
  wasmLoaderPath: `${WASM_URL}/vision_wasm_internal.js`,
  wasmBinaryPath: `${WASM_URL}/vision_wasm_internal.wasm`,
}
const FULL_RANGE_FACE_MODEL_URL = "/models/face_detector/blaze_face_full_range.tflite"
const SHORT_RANGE_FACE_MODEL_URL = "/models/face_detector/blaze_face_short_range.tflite"
const FACE_LANDMARKER_MODEL_URL = "/models/face_landmarker/face_landmarker.task"
const MIN_FACE_SCORE = 0.5

export interface ResourceLoadProgress {
  loaded: number
  total: number
  label: string
}

interface PendingInference {
  resolve: (result: FaceInferenceResult) => void
  reject: (error: Error) => void
}

const createWithGpuFallback = async <T>(createTask: (delegate: "GPU" | "CPU") => Promise<T>) => {
  try {
    return await createTask("GPU")
  } catch (gpuError) {
    console.warn("GPU face inference is unavailable; falling back to CPU", gpuError)
    return createTask("CPU")
  }
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

class MainThreadFaceBackend {
  private fullRangeDetector?: FaceDetector
  private shortRangeDetector?: FaceDetector
  private landmarker?: FaceLandmarker
  private destroyed = false

  private assertActive() {
    if (this.destroyed) throw new Error("Face tracker was destroyed during initialization")
  }

  async initialize(onProgress: (progress: ResourceLoadProgress) => void) {
    const total = 4
    onProgress({ loaded: 0, total, label: "Loading vision runtime" })
    const { FaceDetector, FaceLandmarker } = await import("@mediapipe/tasks-vision")
    this.assertActive()
    const vision = VISION_WASM_FILESET
    this.assertActive()
    const createCanvas = () => typeof OffscreenCanvas === "undefined" ? document.createElement("canvas") : new OffscreenCanvas(1, 1)

    onProgress({ loaded: 1, total, label: "Loading full-range face detector" })
    const fullRangeDetector = await createWithGpuFallback((delegate) => {
      this.assertActive()
      return FaceDetector.createFromOptions(vision, {
        baseOptions: { modelAssetPath: FULL_RANGE_FACE_MODEL_URL, delegate },
        canvas: createCanvas(),
        runningMode: "IMAGE",
        minDetectionConfidence: MIN_FACE_SCORE,
        minSuppressionThreshold: 0.45,
      })
    })
    if (this.destroyed) {
      fullRangeDetector.close()
      this.assertActive()
    }
    this.fullRangeDetector = fullRangeDetector
    this.assertActive()

    onProgress({ loaded: 2, total, label: "Loading short-range face detector" })
    const shortRangeDetector = await createWithGpuFallback((delegate) => {
      this.assertActive()
      return FaceDetector.createFromOptions(vision, {
        baseOptions: { modelAssetPath: SHORT_RANGE_FACE_MODEL_URL, delegate },
        canvas: createCanvas(),
        runningMode: "IMAGE",
        minDetectionConfidence: MIN_FACE_SCORE,
        minSuppressionThreshold: 0.45,
      })
    })
    if (this.destroyed) {
      shortRangeDetector.close()
      this.assertActive()
    }
    this.shortRangeDetector = shortRangeDetector
    this.assertActive()

    onProgress({ loaded: 3, total, label: "Loading fallback face landmarks" })
    this.assertActive()
    const landmarker = await createWithGpuFallback((delegate) => {
      this.assertActive()
      return FaceLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: FACE_LANDMARKER_MODEL_URL, delegate },
        canvas: createCanvas(),
        runningMode: "VIDEO",
        numFaces: 1,
        minFaceDetectionConfidence: MIN_FACE_SCORE,
        minFacePresenceConfidence: 0.5,
        minTrackingConfidence: 0.55,
        outputFaceBlendshapes: false,
        outputFacialTransformationMatrixes: false,
      })
    })
    if (this.destroyed) {
      landmarker.close()
      this.assertActive()
    }
    this.landmarker = landmarker
    this.assertActive()
    onProgress({ loaded: total, total, label: "Fallback face tracker ready" })
  }

  async infer(id: number, mode: FaceInferenceMode, bitmap: ImageBitmap, timestamp: number, detectionRange: FaceDetectionRange): Promise<FaceInferenceResult> {
    const startedAt = performance.now()
    try {
      this.assertActive()
      if (mode === "landmarks") {
        const landmarks = this.landmarker!.detectForVideo(bitmap, timestamp).faceLandmarks[0]
        const face = landmarks ? readLandmarkFace(landmarks) : undefined
        return {
          id,
          type: "result",
          mode,
          timestamp,
          faces: face ? [face] : [],
          center: face && landmarks ? readLandmarkCenter(landmarks, face) : undefined,
          inferenceMs: performance.now() - startedAt,
        }
      }

      const readFaces = (detector: FaceDetector) => detector.detect(bitmap).detections.filter(item => item.boundingBox).map((item) => {
        const box = item.boundingBox!
        return {
          x: box.originX / bitmap.width,
          y: box.originY / bitmap.height,
          width: box.width / bitmap.width,
          height: box.height / bitmap.height,
          score: item.categories[0]?.score ?? 0,
        }
      }).sort((a, b) => b.width * b.height - a.width * a.height).slice(0, 8)
      let faces = readFaces(detectionRange === "short" ? this.shortRangeDetector! : this.fullRangeDetector!)
      if (detectionRange === "short" && !faces.length) faces = readFaces(this.fullRangeDetector!)
      return { id, type: "result", mode, timestamp, faces, inferenceMs: performance.now() - startedAt }
    } finally {
      bitmap.close()
    }
  }

  destroy() {
    this.destroyed = true
    this.fullRangeDetector?.close()
    this.shortRangeDetector?.close()
    this.landmarker?.close()
    this.fullRangeDetector = undefined
    this.shortRangeDetector = undefined
    this.landmarker = undefined
  }
}

export class FaceTrackerClient {
  private worker?: Worker
  private lastInferenceTimestamp = Number.NEGATIVE_INFINITY
  private fallback?: MainThreadFaceBackend
  private initializationPromise?: Promise<void>
  private pending = new Map<number, PendingInference>()
  private nextRequestId = 1
  private workerReady = false
  private workerFailed = false
  private destroyed = false
  private rejectWorkerInitialization?: (error: Error) => void

  initialize(onProgress: (progress: ResourceLoadProgress) => void) {
    if (this.destroyed) return Promise.reject(new Error("Face tracker was destroyed"))
    if (!this.initializationPromise) {
      const initializationPromise = this.initializeBackend(onProgress)
      this.initializationPromise = initializationPromise
      initializationPromise.catch(() => {
        if (!this.destroyed && this.initializationPromise === initializationPromise) {
          this.initializationPromise = undefined
        }
      })
    }
    return this.initializationPromise
  }

  getBackendLabel() {
    if (this.worker && this.workerReady && !this.workerFailed) return "Worker CPU"
    if (this.fallback) return "Main thread fallback"
    return "Initializing"
  }

  private async initializeBackend(onProgress: (progress: ResourceLoadProgress) => void) {
    if (this.destroyed) throw new Error("Face tracker was destroyed")
    const supportsWorker
      = typeof Worker !== "undefined"
        && typeof OffscreenCanvas !== "undefined"
        && typeof createImageBitmap === "function"

    if (supportsWorker) {
      try {
        await this.initializeWorker(onProgress)
        return
      } catch (error) {
        if (this.destroyed) throw error
        console.warn("face tracking worker failed to start; using main thread fallback", error)
        this.disposeWorker()
      }
    }

    if (this.destroyed) throw new Error("Face tracker was destroyed")
    const fallback = new MainThreadFaceBackend()
    this.fallback = fallback
    try {
      await fallback.initialize(onProgress)
    } catch (error) {
      fallback.destroy()
      if (this.fallback === fallback) this.fallback = undefined
      throw error
    }
    if (this.destroyed) {
      fallback.destroy()
      if (this.fallback === fallback) this.fallback = undefined
      throw new Error("Face tracker was destroyed")
    }
  }

  private initializeWorker(onProgress: (progress: ResourceLoadProgress) => void) {
    return new Promise<void>((resolve, reject) => {
      let settled = false
      const resolveInitialization = () => {
        if (settled) return
        settled = true
        this.rejectWorkerInitialization = undefined
        resolve()
      }
      const rejectInitialization = (error: Error) => {
        if (settled) return
        settled = true
        this.rejectWorkerInitialization = undefined
        reject(error)
      }
      this.rejectWorkerInitialization = rejectInitialization
      // MediaPipe loads its generated WASM bootstrap with importScripts().
      // Keep this a classic worker; module workers reject importScripts().
      let worker: Worker
      try {
        worker = new Worker(new URL("./worker.ts", import.meta.url))
      } catch (error) {
        rejectInitialization(error instanceof Error ? error : new Error(String(error)))
        return
      }
      this.workerFailed = false
      this.worker = worker
      worker.onmessage = (event: MessageEvent<FaceWorkerResponse>) => {
        const message = event.data
        if (message.type === "progress") {
          if (!this.destroyed) onProgress(message)
        } else if (message.type === "ready") {
          if (this.destroyed) {
            rejectInitialization(new Error("Face tracker was destroyed"))
            return
          }
          this.workerReady = true
          resolveInitialization()
        } else if (message.type === "result") {
          const pending = this.pending.get(message.id)
          this.pending.delete(message.id)
          pending?.resolve(message)
        } else {
          const error = new Error(message.message)
          if (message.id !== undefined) {
            const pending = this.pending.get(message.id)
            this.pending.delete(message.id)
            pending?.reject(error)
          } else {
            rejectInitialization(error)
          }
        }
      }
      worker.onerror = (event) => {
        const error = new Error(event.message || "Face tracking worker crashed")
        if (!this.workerReady) rejectInitialization(error)
        this.workerFailed = true
        for (const pending of this.pending.values()) pending.reject(error)
        this.pending.clear()
        this.disposeWorker()
      }
      try {
        worker.postMessage({ type: "init" })
      } catch (error) {
        this.disposeWorker()
        rejectInitialization(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  async infer(mode: FaceInferenceMode, bitmap: ImageBitmap, timestamp: number, detectionRange: FaceDetectionRange = "full") {
    try {
      await (this.initializationPromise ?? this.initialize(() => {}))
    } catch (error) {
      bitmap.close()
      throw error
    }
    if (this.destroyed) {
      bitmap.close()
      throw new Error("Face tracker was destroyed")
    }
    const id = this.nextRequestId++
    const inferenceTimestamp = Math.max(Math.ceil(timestamp), this.lastInferenceTimestamp + 1)
    this.lastInferenceTimestamp = inferenceTimestamp
    if (this.worker && this.workerReady && !this.workerFailed) {
      return new Promise<FaceInferenceResult>((resolve, reject) => {
        this.pending.set(id, { resolve, reject })
        try {
          this.worker!.postMessage({ id, type: "infer", mode, detectionRange, timestamp: inferenceTimestamp, bitmap }, [bitmap])
        } catch (error) {
          this.pending.delete(id)
          this.workerFailed = true
          this.disposeWorker()
          bitmap.close()
          reject(error instanceof Error ? error : new Error(String(error)))
        }
      })
    }

    if (!this.fallback) {
      const fallback = new MainThreadFaceBackend()
      this.fallback = fallback
      try {
        await fallback.initialize(() => {})
      } catch (error) {
        fallback.destroy()
        if (this.fallback === fallback) this.fallback = undefined
        bitmap.close()
        throw error
      }
      if (this.destroyed) {
        fallback.destroy()
        if (this.fallback === fallback) this.fallback = undefined
        bitmap.close()
        throw new Error("Face tracker was destroyed")
      }
    }
    return this.fallback.infer(id, mode, bitmap, inferenceTimestamp, detectionRange)
  }

  private disposeWorker() {
    this.worker?.terminate()
    this.worker = undefined
    this.workerReady = false
  }

  destroy() {
    if (this.destroyed) return
    this.destroyed = true
    this.rejectWorkerInitialization?.(new Error("Face tracker was destroyed"))
    this.rejectWorkerInitialization = undefined
    this.disposeWorker()
    this.fallback?.destroy()
    this.fallback = undefined
    for (const pending of this.pending.values()) pending.reject(new Error("Face tracker was destroyed"))
    this.pending.clear()
  }
}

let sharedClient: FaceTrackerClient | undefined

export const getFaceTrackerClient = () => {
  sharedClient ??= new FaceTrackerClient()
  return sharedClient
}

export const preloadFaceAutoCenterResources = (
  onProgress: (progress: ResourceLoadProgress) => void,
) => getFaceTrackerClient().initialize(onProgress)

export const releaseFaceAutoCenterResources = () => {
  sharedClient?.destroy()
  sharedClient = undefined
}
