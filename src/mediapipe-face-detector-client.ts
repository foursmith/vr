import type { FaceDetectionRange, FaceInferenceMode } from "./features/face-tracking/protocol"
import { getFaceTrackerClient, releaseFaceAutoCenterResources } from "./features/face-tracking/client"

export const createMediaPipeFaceDetectorClient = () => {
  const tracker = getFaceTrackerClient()
  let destroyed = false

  return {
    detect: async (
      source: ImageBitmapSource,
      detectionRange: FaceDetectionRange = "full",
      inferenceMode: FaceInferenceMode = "detection",
    ) => {
      if (destroyed) throw new Error("MediaPipe face detector was destroyed")
      const bitmap = await createImageBitmap(source)
      if (destroyed) {
        bitmap.close()
        throw new Error("MediaPipe face detector was destroyed")
      }
      const width = bitmap.width
      const height = bitmap.height
      const result = await tracker.infer(inferenceMode, bitmap, performance.now(), detectionRange)
      return result.faces.map(face => ({
        boundingBox: {
          x: face.x * width,
          y: face.y * height,
          width: face.width * width,
          height: face.height * height,
        },
        score: face.score,
        pose: face.pose,
        center: result.center
          ? { x: result.center.x * width, y: result.center.y * height }
          : undefined,
      }))
    },
    destroy: () => {
      if (destroyed) return
      destroyed = true
      releaseFaceAutoCenterResources()
    },
  }
}
