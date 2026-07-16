import type { FaceDetector } from "@mediapipe/tasks-vision"
import type {
  FaceDetectionRange,
  FaceInferenceResult,
  FaceWorkerResponse,
} from "./protocol"
import { MIN_FACE_CONFIDENCE } from "./protocol"

const WASM_URL = "/mediapipe/tasks-vision/wasm"
const VISION_WASM_FILESET = {
  wasmLoaderPath: `${WASM_URL}/vision_wasm_internal.js`,
  wasmBinaryPath: `${WASM_URL}/vision_wasm_internal.wasm`,
}
const FULL_RANGE_FACE_MODEL_URL = "/models/face_detector/blaze_face_full_range.tflite"
const SHORT_RANGE_FACE_MODEL_URL = "/models/face_detector/blaze_face_short_range.tflite"
const REMOVED_FACE_LANDMARKER_MODEL_URL = "/models/face_landmarker/face_landmarker.task"

const FACE_DETECTION_RESOURCES = [
  { url: VISION_WASM_FILESET.wasmLoaderPath, cacheName: "face-tracking-runtime" },
  { url: VISION_WASM_FILESET.wasmBinaryPath, cacheName: "face-tracking-runtime" },
  { url: FULL_RANGE_FACE_MODEL_URL, cacheName: "face-tracking-models" },
  { url: SHORT_RANGE_FACE_MODEL_URL, cacheName: "face-tracking-models" },
] as const
type FaceTrackingResource = (typeof FACE_DETECTION_RESOURCES)[number]

export interface ResourceLoadProgress {
  loaded: number
  total: number
  label: string
}

const downloadResource = async (resource: FaceTrackingResource) => {
  const request = new Request(new URL(resource.url, window.location.origin))
  if (typeof caches === "undefined") {
    const response = await fetch(request)
    if (!response.ok) throw new Error(`Failed to download ${resource.url}: ${response.status}`)
    await response.arrayBuffer()
    return
  }

  const cache = await caches.open(resource.cacheName)
  if (await cache.match(request)) return
  const response = await fetch(request)
  if (!response.ok) throw new Error(`Failed to download ${resource.url}: ${response.status}`)
  await cache.put(request, response)
}

export const downloadFaceTrackingResources = async (
  onProgress: (progress: ResourceLoadProgress) => void,
) => {
  if (typeof caches !== "undefined") {
    const modelCache = await caches.open("face-tracking-models")
    await modelCache.delete(new Request(new URL(REMOVED_FACE_LANDMARKER_MODEL_URL, window.location.origin)))
  }
  const resources: readonly FaceTrackingResource[] = FACE_DETECTION_RESOURCES
  const total = resources.length
  onProgress({ loaded: 0, total, label: "Downloading face tracking resources" })
  let loaded = 0
  for (const resource of resources) {
    await downloadResource(resource)
    loaded += 1
    onProgress({ loaded, total, label: "Downloading face tracking resources" })
  }
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

class MainThreadFaceBackend {
  private fullRangeDetector?: FaceDetector
  private shortRangeDetector?: FaceDetector
  private visionTasks?: typeof import("@mediapipe/tasks-vision")
  private fullRangeDetectorPromise?: Promise<FaceDetector>
  private shortRangeDetectorPromise?: Promise<FaceDetector>
  private destroyed = false

  private assertActive() {
    if (this.destroyed) throw new Error("Face tracker was destroyed during initialization")
  }

  async initialize(onProgress: (progress: ResourceLoadProgress) => void) {
    const total = 1
    onProgress({ loaded: 0, total, label: "Loading vision runtime" })
    this.visionTasks = await import("@mediapipe/tasks-vision")
    this.assertActive()
    onProgress({ loaded: total, total, label: "Fallback face tracker ready" })
  }

  private createCanvas() {
    return typeof OffscreenCanvas === "undefined" ? document.createElement("canvas") : new OffscreenCanvas(1, 1)
  }

  private createDetector(range: FaceDetectionRange) {
    const modelAssetPath = range === "short" ? SHORT_RANGE_FACE_MODEL_URL : FULL_RANGE_FACE_MODEL_URL
    return createWithGpuFallback((delegate) => {
      this.assertActive()
      return this.visionTasks!.FaceDetector.createFromOptions(VISION_WASM_FILESET, {
        baseOptions: { modelAssetPath, delegate },
        canvas: this.createCanvas(),
        runningMode: "IMAGE",
        minDetectionConfidence: MIN_FACE_CONFIDENCE,
        minSuppressionThreshold: 0.45,
      })
    })
  }

  private async getDetector(range: FaceDetectionRange) {
    this.assertActive()
    if (range === "short") {
      this.shortRangeDetectorPromise ??= this.createDetector("short")
      const detector = await this.shortRangeDetectorPromise
      if (this.destroyed) {
        detector.close()
        this.assertActive()
      }
      this.shortRangeDetector ??= detector
      return this.shortRangeDetector
    }
    this.fullRangeDetectorPromise ??= this.createDetector("full")
    const detector = await this.fullRangeDetectorPromise
    if (this.destroyed) {
      detector.close()
      this.assertActive()
    }
    this.fullRangeDetector ??= detector
    return this.fullRangeDetector
  }

  async infer(id: number, bitmap: ImageBitmap, timestamp: number, detectionRange: FaceDetectionRange): Promise<FaceInferenceResult> {
    const startedAt = performance.now()
    try {
      this.assertActive()
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
      const faces = readFaces(await this.getDetector(detectionRange))
      return { id, type: "result", timestamp, faces, inferenceMs: performance.now() - startedAt }
    } finally {
      bitmap.close()
    }
  }

  destroy() {
    this.destroyed = true
    this.fullRangeDetector?.close()
    this.shortRangeDetector?.close()
    this.fullRangeDetector = undefined
    this.shortRangeDetector = undefined
    this.fullRangeDetectorPromise = undefined
    this.shortRangeDetectorPromise = undefined
    this.visionTasks = undefined
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
        worker = new Worker(new URL("./face-detector-worker.ts", import.meta.url))
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

  async infer(bitmap: ImageBitmap, timestamp: number, detectionRange: FaceDetectionRange = "full") {
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
          this.worker!.postMessage({ id, type: "infer", detectionRange, timestamp: inferenceTimestamp, bitmap }, [bitmap])
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
    return this.fallback.infer(id, bitmap, inferenceTimestamp, detectionRange)
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
