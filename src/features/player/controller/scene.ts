import type { CameraView, createVrScene, VrSceneController } from "../../vr/scene"
import { createSignal, createStore } from "solid-js"
import { DEFAULT_FORWARD, DEFAULT_ZOOM } from "../../vr/config"

type SceneConfiguration = Omit<
  Parameters<typeof createVrScene>[0],
  "root" | "mount" | "sampleCanvas" | "hintElement" | "fpsElement" | "video" | "viewRef" | "onFaceAutoCenterPauseChange" | "onProjectionBoundaryWarning"
>

interface PlayerSceneOptions {
  getConfiguration: () => SceneConfiguration
  getLoadGeneration: () => number
  getVideo: () => HTMLVideoElement
  isCurrentLoad: (generation: number) => boolean
  onReady: () => void
}

export const createPlayerScene = (options: PlayerSceneOptions) => {
  let scene: VrSceneController | undefined
  let root!: HTMLElement
  let mount!: HTMLDivElement
  let sampleCanvas!: HTMLCanvasElement
  let faceHint!: HTMLDivElement
  let fpsMeter!: HTMLDivElement
  let loadingPromise: Promise<void> | undefined
  let initialized = false
  let boundaryWarningTimer: number | undefined
  const viewRef = {
    current: {
      yaw: 0,
      pitch: 0,
      zoom: DEFAULT_ZOOM,
      forward: DEFAULT_FORWARD,
      pausedUntil: 0,
    } satisfies CameraView,
  }
  const [faceAutoCenterPaused, setFaceAutoCenterPaused] = createSignal(false)
  const [debugPanelOpen, setDebugPanelOpen] = createSignal(false)
  const [projectionBoundaryWarning, setProjectionBoundaryWarning] = createSignal<Parameters<NonNullable<Parameters<typeof createVrScene>[0]["onProjectionBoundaryWarning"]>>[0]>()
  const [loadingState, setLoadingState] = createStore({
    resourcesReady: true,
    progress: 100,
    label: "Ready",
    error: undefined as string | undefined,
  })

  const showBoundaryWarning = (warning: Parameters<NonNullable<Parameters<typeof createVrScene>[0]["onProjectionBoundaryWarning"]>>[0]) => {
    setProjectionBoundaryWarning(warning)
    if (boundaryWarningTimer !== undefined) window.clearTimeout(boundaryWarningTimer)
    boundaryWarningTimer = window.setTimeout(() => {
      boundaryWarningTimer = undefined
      setProjectionBoundaryWarning(undefined)
    }, 1600)
  }

  const showVideoTranslationLayer = () => {
    const video = options.getVideo()
    video.classList.remove("hidden")
    video.classList.add("block", "opacity-[0.01]", "pointer-events-none")
    video.dataset.displayMode = "vr-translation-layer"
  }

  const start = () => {
    if (loadingPromise || initialized) return loadingPromise
    const generation = options.getLoadGeneration()
    loadingPromise = (async () => {
      setLoadingState((draft) => {
        draft.resourcesReady = false
        draft.error = undefined
        draft.label = "Starting VR player"
        draft.progress = 75
      })
      try {
        const { createVrScene: createScene } = await import("../../vr/scene")
        if (!options.isCurrentLoad(generation)) return
        scene = createScene({
          root,
          mount,
          sampleCanvas,
          hintElement: faceHint,
          fpsElement: fpsMeter,
          video: options.getVideo(),
          viewRef,
          onFaceAutoCenterPauseChange: setFaceAutoCenterPaused,
          onProjectionBoundaryWarning: showBoundaryWarning,
          ...options.getConfiguration(),
        })
        showVideoTranslationLayer()
        initialized = true
        setLoadingState((draft) => {
          draft.label = "Ready"
          draft.progress = 100
          draft.resourcesReady = true
        })
        options.onReady()
      } catch (error) {
        if (!options.isCurrentLoad(generation)) return
        console.warn("initial resource loading failed", error)
        setLoadingState((draft) => {
          draft.error = "Couldn’t get the player ready"
          draft.label = "Try again"
        })
      }
    })().finally(() => {
      loadingPromise = undefined
    })
    return loadingPromise
  }

  const reset = () => {
    scene?.destroy()
    scene = undefined
    initialized = false
    setLoadingState((draft) => {
      draft.resourcesReady = true
      draft.progress = 100
      draft.label = "Ready"
      draft.error = undefined
    })
    const video = options.getVideo()
    video.classList.add("hidden")
    video.classList.remove("block", "opacity-[0.01]", "pointer-events-none")
    delete video.dataset.displayMode
  }

  const destroy = () => {
    if (boundaryWarningTimer !== undefined) window.clearTimeout(boundaryWarningTimer)
    scene?.destroy()
    scene = undefined
    initialized = false
  }

  return {
    debugPanelOpen,
    destroy,
    faceAutoCenterPaused,
    getMount: () => mount,
    getScene: () => scene,
    isInitialized: () => initialized,
    loadingPercent: () => Math.round(Math.min(100, Math.max(0, loadingState.progress))),
    loadingState,
    pauseFaceAutoCenter: () => scene?.pauseFaceAutoCenter(),
    projectionBoundaryWarning,
    reset,
    resetMedia: () => scene?.resetMedia(),
    resourcesReady: () => loadingState.resourcesReady,
    resumeFaceAutoCenter: () => scene?.resumeFaceAutoCenter(),
    setDebugPanelOpen,
    setFaceHint: (element: HTMLDivElement) => (faceHint = element),
    setFpsMeter: (element: HTMLDivElement) => (fpsMeter = element),
    setMount: (element: HTMLDivElement) => (mount = element),
    setRoot: (element: HTMLElement) => (root = element),
    setSampleCanvas: (element: HTMLCanvasElement) => (sampleCanvas = element),
    start,
    update: (configuration: SceneConfiguration) => {
      scene?.update(configuration)
      showVideoTranslationLayer()
    },
    viewRef,
  }
}
