import type { FaceDetector, FaceLandmarker, NormalizedLandmark } from '@mediapipe/tasks-vision'
import type {
  FaceInferenceMode,
  FaceInferenceResult,
  FaceWorkerResponse,
  NormalizedFace,
} from './protocol'

const WASM_URL = '/mediapipe/tasks-vision/wasm'
const FACE_MODEL_URL = '/models/face_detector/blaze_face_full_range.tflite'
const FACE_LANDMARKER_MODEL_URL = '/models/face_landmarker/face_landmarker.task'
const MIN_FACE_SCORE = 0.5

export type ResourceLoadProgress = {
  loaded: number
  total: number
  label: string
}

type PendingInference = {
  resolve: (result: FaceInferenceResult) => void
  reject: (error: Error) => void
}

const createWithGpuFallback = async <T>(createTask: (delegate: 'GPU' | 'CPU') => Promise<T>) => {
  try {
    return await createTask('GPU')
  } catch (gpuError) {
    console.warn('GPU face inference is unavailable; falling back to CPU', gpuError)
    return createTask('CPU')
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
  private detector?: FaceDetector
  private landmarker?: FaceLandmarker

  async initialize(onProgress: (progress: ResourceLoadProgress) => void) {
    const total = 3
    onProgress({ loaded: 0, total, label: 'Loading vision runtime' })
    const { FaceDetector, FaceLandmarker, FilesetResolver } = await import('@mediapipe/tasks-vision')
    const vision = await FilesetResolver.forVisionTasks(WASM_URL)
    const createCanvas = () => typeof OffscreenCanvas === 'undefined' ? document.createElement('canvas') : new OffscreenCanvas(1, 1)

    onProgress({ loaded: 1, total, label: 'Loading fallback face detector' })
    this.detector = await createWithGpuFallback((delegate) => FaceDetector.createFromOptions(vision, {
      baseOptions: { modelAssetPath: FACE_MODEL_URL, delegate },
      canvas: createCanvas(),
      runningMode: 'IMAGE',
      minDetectionConfidence: MIN_FACE_SCORE,
      minSuppressionThreshold: 0.45,
    }))

    onProgress({ loaded: 2, total, label: 'Loading fallback face landmarks' })
    this.landmarker = await createWithGpuFallback((delegate) => FaceLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: FACE_LANDMARKER_MODEL_URL, delegate },
      canvas: createCanvas(),
      runningMode: 'VIDEO',
      numFaces: 1,
      minFaceDetectionConfidence: MIN_FACE_SCORE,
      minFacePresenceConfidence: 0.5,
      minTrackingConfidence: 0.55,
      outputFaceBlendshapes: false,
      outputFacialTransformationMatrixes: false,
    }))
    onProgress({ loaded: total, total, label: 'Fallback face tracker ready' })
  }

  async infer(id: number, mode: FaceInferenceMode, bitmap: ImageBitmap, timestamp: number): Promise<FaceInferenceResult> {
    const startedAt = performance.now()
    try {
      if (mode === 'landmarks') {
        const landmarks = this.landmarker!.detectForVideo(bitmap, timestamp).faceLandmarks[0]
        const face = landmarks ? readLandmarkFace(landmarks) : undefined
        return {
          id,
          type: 'result',
          mode,
          timestamp,
          faces: face ? [face] : [],
          center: face && landmarks ? readLandmarkCenter(landmarks, face) : undefined,
          inferenceMs: performance.now() - startedAt,
        }
      }

      const faces = this.detector!.detect(bitmap).detections
        .filter((item) => item.boundingBox)
        .map((item) => {
          const box = item.boundingBox!
          return {
            x: box.originX / bitmap.width,
            y: box.originY / bitmap.height,
            width: box.width / bitmap.width,
            height: box.height / bitmap.height,
            score: item.categories[0]?.score ?? 0,
          }
        })
        .sort((a, b) => b.width * b.height - a.width * a.height)
        .slice(0, 8)
      return { id, type: 'result', mode, timestamp, faces, inferenceMs: performance.now() - startedAt }
    } finally {
      bitmap.close()
    }
  }

  destroy() {
    this.detector?.close()
    this.landmarker?.close()
  }
}

export class FaceTrackerClient {
  private worker?: Worker
  private fallback?: MainThreadFaceBackend
  private initializationPromise?: Promise<void>
  private pending = new Map<number, PendingInference>()
  private nextRequestId = 1
  private workerReady = false
  private workerFailed = false

  initialize(onProgress: (progress: ResourceLoadProgress) => void) {
    this.initializationPromise ??= this.initializeBackend(onProgress)
    return this.initializationPromise
  }

  getBackendLabel() {
    if (this.worker && this.workerReady && !this.workerFailed) return 'Worker CPU'
    if (this.fallback) return 'Main thread fallback'
    return 'Initializing'
  }

  private async initializeBackend(onProgress: (progress: ResourceLoadProgress) => void) {
    const supportsWorker =
      typeof Worker !== 'undefined' &&
      typeof OffscreenCanvas !== 'undefined' &&
      typeof createImageBitmap === 'function'

    if (supportsWorker) {
      try {
        await this.initializeWorker(onProgress)
        return
      } catch (error) {
        console.warn('face tracking worker failed to start; using main thread fallback', error)
        this.disposeWorker()
      }
    }

    this.fallback = new MainThreadFaceBackend()
    await this.fallback.initialize(onProgress)
  }

  private initializeWorker(onProgress: (progress: ResourceLoadProgress) => void) {
    return new Promise<void>((resolve, reject) => {
      // MediaPipe loads its generated WASM bootstrap with importScripts().
      // Keep this a classic worker; module workers reject importScripts().
      const worker = new Worker(new URL('./worker.ts', import.meta.url))
      this.worker = worker
      worker.onmessage = (event: MessageEvent<FaceWorkerResponse>) => {
        const message = event.data
        if (message.type === 'progress') {
          onProgress(message)
        } else if (message.type === 'ready') {
          this.workerReady = true
          resolve()
        } else if (message.type === 'result') {
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
            reject(error)
          }
        }
      }
      worker.onerror = (event) => {
        const error = new Error(event.message || 'Face tracking worker crashed')
        if (!this.workerReady) reject(error)
        this.workerFailed = true
        for (const pending of this.pending.values()) pending.reject(error)
        this.pending.clear()
        this.disposeWorker()
      }
      worker.postMessage({ type: 'init' })
    })
  }

  async infer(mode: FaceInferenceMode, bitmap: ImageBitmap, timestamp: number) {
    await (this.initializationPromise ?? this.initialize(() => {}))
    const id = this.nextRequestId++
    if (this.worker && this.workerReady && !this.workerFailed) {
      return new Promise<FaceInferenceResult>((resolve, reject) => {
        this.pending.set(id, { resolve, reject })
        try {
          this.worker!.postMessage({ id, type: 'infer', mode, timestamp, bitmap }, [bitmap])
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
      this.fallback = new MainThreadFaceBackend()
      await this.fallback.initialize(() => {})
    }
    return this.fallback.infer(id, mode, bitmap, timestamp)
  }

  private disposeWorker() {
    this.worker?.terminate()
    this.worker = undefined
    this.workerReady = false
  }

  destroy() {
    this.disposeWorker()
    this.fallback?.destroy()
    this.fallback = undefined
    for (const pending of this.pending.values()) pending.reject(new Error('Face tracker was destroyed'))
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
