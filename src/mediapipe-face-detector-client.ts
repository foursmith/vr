import { getFaceTrackerClient, releaseFaceAutoCenterResources } from "./features/face-tracking/client"

export const createMediaPipeFaceDetectorClient = () => {
  const tracker = getFaceTrackerClient()
  let destroyed = false

  return {
    detect: async (source: ImageBitmapSource) => {
      if (destroyed) throw new Error("MediaPipe face detector was destroyed")
      const bitmap = await createImageBitmap(source)
      if (destroyed) {
        bitmap.close()
        throw new Error("MediaPipe face detector was destroyed")
      }
      const width = bitmap.width
      const height = bitmap.height
      const result = await tracker.infer("detection", bitmap, performance.now(), "full")
      return result.faces.map(face => ({
        boundingBox: {
          x: face.x * width,
          y: face.y * height,
          width: face.width * width,
          height: face.height * height,
        },
      }))
    },
    destroy: () => {
      if (destroyed) return
      destroyed = true
      releaseFaceAutoCenterResources()
    },
  }
}
