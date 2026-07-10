const FACE_DEBUG_WASM_URL = '/mediapipe/tasks-vision/wasm'
const FACE_DEBUG_MODEL_URL = '/models/face_detector/blaze_face_full_range.tflite'

export type DebugFace = { x: number; y: number; width: number; height: number; score: number }

let debugDetectorPromise: Promise<import('@mediapipe/tasks-vision').FaceDetector> | undefined

export const getDebugDetector = async () => {
  if (!debugDetectorPromise) {
    const detectorPromise = import('@mediapipe/tasks-vision').then(async ({ FaceDetector, FilesetResolver }) => {
      const vision = await FilesetResolver.forVisionTasks(FACE_DEBUG_WASM_URL)
      return FaceDetector.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: FACE_DEBUG_MODEL_URL,
          delegate: 'CPU',
        },
        runningMode: 'IMAGE',
        minDetectionConfidence: 0.25,
        minSuppressionThreshold: 0.3,
      })
    })
    debugDetectorPromise = detectorPromise
    detectorPromise.catch(() => {
      if (debugDetectorPromise === detectorPromise) debugDetectorPromise = undefined
    })
  }
  return debugDetectorPromise
}

export const releaseDebugDetector = () => {
  const detectorPromise = debugDetectorPromise
  debugDetectorPromise = undefined
  void detectorPromise?.then((detector) => detector.close()).catch(() => {})
}
