/// <reference lib="webworker" />

export {}

interface NativeDetectedFace {
  boundingBox: { x: number, y: number, width: number, height: number }
}

interface NativeFaceDetector {
  detect: (image: ImageBitmapSource) => Promise<NativeDetectedFace[]>
}

interface NativeFaceDetectorConstructor {
  new(options?: { fastMode?: boolean, maxDetectedFaces?: number }): NativeFaceDetector
}

type WorkerRequest
  = | { type: "init" }
    | { type: "detect", id: number, bitmap: ImageBitmap }

type WorkerResponse
  = | { type: "ready" }
    | { type: "result", id: number, faces: NativeDetectedFace[] }
    | { type: "error", id?: number, message: string }

const scope = globalThis as unknown as DedicatedWorkerGlobalScope & { FaceDetector?: NativeFaceDetectorConstructor }
let detector: NativeFaceDetector | undefined

const post = (message: WorkerResponse) => scope.postMessage(message)

scope.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const request = event.data
  if (request.type === "init") {
    if (!scope.FaceDetector) {
      post({ type: "error", message: "System FaceDetector is unavailable in Worker" })
      return
    }
    try {
      detector = new scope.FaceDetector({ fastMode: true, maxDetectedFaces: 4 })
      post({ type: "ready" })
    } catch (error) {
      post({ type: "error", message: error instanceof Error ? error.message : String(error) })
    }
    return
  }

  if (!detector) {
    request.bitmap.close()
    post({ type: "error", id: request.id, message: "System FaceDetector is not initialized" })
    return
  }

  void detector.detect(request.bitmap)
    .then(faces => post({
      type: "result",
      id: request.id,
      faces: faces.map(face => ({
        boundingBox: {
          x: face.boundingBox.x,
          y: face.boundingBox.y,
          width: face.boundingBox.width,
          height: face.boundingBox.height,
        },
      })),
    }))
    .catch(error => post({
      type: "error",
      id: request.id,
      message: error instanceof Error ? error.message : String(error),
    }))
    .finally(() => request.bitmap.close())
}
