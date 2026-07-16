import type { FaceDetectionRange } from "./protocol"

export interface DetectedFace {
  boundingBox: {
    x: number
    y: number
    width: number
    height: number
  }
  score?: number
}

export interface FaceDetectorBackend {
  detect: (
    source: ImageBitmapSource,
    detectionRange: FaceDetectionRange,
  ) => Promise<DetectedFace[]>
  destroy: () => void
}

export type FaceDetectorBackendLoader = () => Promise<FaceDetectorBackend>

export interface FaceDetectorService {
  ensure: () => Promise<FaceDetectorBackend>
  isReady: () => boolean
  release: () => void
  destroy: () => void
}

const loadMediaPipeFaceDetector: FaceDetectorBackendLoader = async () => {
  const module = await import("./mediapipe-client")
  return module.createMediaPipeFaceDetectorClient()
}

export const createFaceDetectorService = (
  loadBackend: FaceDetectorBackendLoader = loadMediaPipeFaceDetector,
): FaceDetectorService => {
  let backend: FaceDetectorBackend | undefined
  let backendPromise: Promise<FaceDetectorBackend> | undefined
  let detectorGeneration = 0
  let destroyed = false

  const ensure = () => {
    if (destroyed) return Promise.reject(new Error("Face detector service was destroyed"))
    if (backend) return Promise.resolve(backend)
    if (backendPromise) return backendPromise

    const generation = detectorGeneration
    const loading = loadBackend()
    backendPromise = loading.then((loadedBackend) => {
      if (destroyed || generation !== detectorGeneration) {
        loadedBackend.destroy()
        throw new Error("Face detector initialization was superseded")
      }
      backend = loadedBackend
      return loadedBackend
    }).catch((error) => {
      if (generation === detectorGeneration) backendPromise = undefined
      throw error
    })
    return backendPromise
  }

  const release = () => {
    detectorGeneration += 1
    backend?.destroy()
    backend = undefined
    backendPromise = undefined
  }

  return {
    ensure,
    isReady: () => backend !== undefined,
    release,
    destroy: () => {
      if (destroyed) return
      destroyed = true
      release()
    },
  }
}
