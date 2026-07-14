import type { CameraView } from "../vr/scene"
import { createSignal, createStore } from "solid-js"
import { DEFAULT_ZOOM, QUALITY_OPTIONS } from "../vr/scene"

type ValueUpdate<T> = T | ((current: T) => T)
interface ViewRef { current: CameraView }

const resolveUpdate = <T>(current: T, update: ValueUpdate<T>) =>
  typeof update === "function" ? (update as (current: T) => T)(current) : update

export function createDisplay(options: {
  getPlayer: () => HTMLElement
  resourcesReady: () => boolean
  viewRef: ViewRef
  initialState?: Partial<{
    qualityId: number
    renderFrameRateId: number
    splitScreen: boolean
    faceAutoCenter: boolean
  }>
}) {
  const [state, setState] = createStore({
    presetId: 0,
    qualityId: options.initialState?.qualityId ?? 2,
    renderFrameRateId: options.initialState?.renderFrameRateId ?? 3,
    splitScreen: options.initialState?.splitScreen ?? true,
    faceAutoCenter: options.initialState?.faceAutoCenter ?? true,
  })
  const [zoom, setZoomSignal] = createSignal(DEFAULT_ZOOM)
  const [fullscreen, setFullscreen] = createSignal(false)

  const setValue = <K extends keyof typeof state>(key: K, update: ValueUpdate<(typeof state)[K]>) => {
    setState((draft) => {
      draft[key] = resolveUpdate(draft[key], update)
    })
  }
  const setPresetId = (update: ValueUpdate<number>) => {
    const next = resolveUpdate(state.presetId, update)
    setValue("presetId", next)
    return next
  }
  const setQualityId = (update: ValueUpdate<number>) => setValue("qualityId", update)
  const setRenderFrameRateId = (update: ValueUpdate<number>) => {
    const next = resolveUpdate(state.renderFrameRateId, update)
    setValue("renderFrameRateId", Math.min(3, Math.max(1, Math.round(next))))
  }
  const setSplitScreen = (update: ValueUpdate<boolean>) => setValue("splitScreen", update)
  const setFaceAutoCenter = (update: ValueUpdate<boolean>) => setValue("faceAutoCenter", update)

  const setZoom = (next: number) => {
    if (!options.resourcesReady()) return
    const clamped = Math.min(2.4, Math.max(0.8, next))
    options.viewRef.current.zoom = clamped
    options.viewRef.current.pausedUntil = performance.now() + 900
    setZoomSignal(clamped)
  }

  const syncZoom = (next: number) => {
    options.viewRef.current.zoom = next
    setZoomSignal(next)
  }

  const restorePreset = (presetId: number) => {
    setValue("presetId", presetId)
  }

  const resetTransientView = () => {
    options.viewRef.current.yaw = 0
    options.viewRef.current.pitch = 0
    options.viewRef.current.zoom = DEFAULT_ZOOM
    options.viewRef.current.pausedUntil = performance.now() + 900
    setZoomSignal(DEFAULT_ZOOM)
  }

  const resetView = () => {
    if (!options.resourcesReady()) return
    resetTransientView()
  }

  const changeQualityBy = (amount: number) => {
    if (!options.resourcesReady()) return
    setQualityId(current => Math.min(QUALITY_OPTIONS.length - 1, Math.max(0, current + amount)))
  }

  const toggleFullscreen = async () => {
    if (!options.resourcesReady()) return
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen()
      } else {
        await options.getPlayer().requestFullscreen()
      }
    } catch (error) {
      console.warn("fullscreen toggle failed", error)
    }
  }

  const syncFullscreen = () => {
    setFullscreen(document.fullscreenElement === options.getPlayer())
  }

  const controller = {
    fullscreen,
    resetView,
    setFaceAutoCenter,
    setPresetId,
    setQualityId,
    setRenderFrameRateId,
    setSplitScreen,
    setZoom,
    state,
    toggleFullscreen,
    zoom,
  }

  return {
    changeQualityBy,
    controller,
    faceAutoCenter: () => state.faceAutoCenter,
    presetId: () => state.presetId,
    qualityId: () => state.qualityId,
    renderFrameRateId: () => state.renderFrameRateId,
    splitScreen: () => state.splitScreen,
    resetTransientView,
    restorePreset,
    syncFullscreen,
    syncZoom,
  }
}
