export interface SystemDetectedFace {
  boundingBox: { x: number, y: number, width: number, height: number }
}

type WorkerResponse
  = | { type: "ready" }
    | { type: "result", id: number, faces: SystemDetectedFace[] }
    | { type: "error", id?: number, message: string }

interface PendingDetection {
  resolve: (faces: SystemDetectedFace[]) => void
  reject: (error: Error) => void
}

export const createSystemFaceDetectorWorkerClient = () => {
  if (typeof Worker === "undefined" || typeof createImageBitmap !== "function") {
    throw new Error("System face detection Worker is unavailable")
  }

  const worker = new Worker(new URL("./system-face-detector.worker.ts", import.meta.url), { type: "module" })
  const pending = new Map<number, PendingDetection>()
  let nextId = 1
  let destroyed = false
  let resolveReady!: () => void
  let rejectReady!: (error: Error) => void
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve
    rejectReady = reject
  })

  const rejectAll = (error: Error) => {
    rejectReady(error)
    for (const detection of pending.values()) detection.reject(error)
    pending.clear()
  }

  worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const response = event.data
    if (response.type === "ready") {
      resolveReady()
    } else if (response.type === "result") {
      const detection = pending.get(response.id)
      pending.delete(response.id)
      detection?.resolve(response.faces)
    } else {
      const error = new Error(response.message)
      if (response.id === undefined) {
        rejectAll(error)
      } else {
        const detection = pending.get(response.id)
        pending.delete(response.id)
        detection?.reject(error)
      }
    }
  }
  worker.onerror = event => rejectAll(new Error(event.message || "System face detection Worker crashed"))
  worker.postMessage({ type: "init" })

  return {
    detect: async (source: ImageBitmapSource) => {
      await ready
      if (destroyed) throw new Error("System face detection Worker was destroyed")
      const bitmap = await createImageBitmap(source)
      if (destroyed) {
        bitmap.close()
        throw new Error("System face detection Worker was destroyed")
      }
      const id = nextId++
      return new Promise<SystemDetectedFace[]>((resolve, reject) => {
        pending.set(id, { resolve, reject })
        try {
          worker.postMessage({ type: "detect", id, bitmap }, [bitmap])
        } catch (error) {
          pending.delete(id)
          bitmap.close()
          reject(error instanceof Error ? error : new Error(String(error)))
        }
      })
    },
    destroy: () => {
      if (destroyed) return
      destroyed = true
      worker.terminate()
      rejectAll(new Error("System face detection Worker was destroyed"))
    },
  }
}
