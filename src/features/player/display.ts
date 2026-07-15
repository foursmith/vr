import type { CameraView } from "@foursmith/player-core/config"
import { DEFAULT_FORWARD, QUALITY_OPTIONS } from "@foursmith/player-core/config"
import { createSignal, createStore } from "solid-js"

type ValueUpdate<T> = T | ((current: T) => T)
interface ViewRef { current: CameraView }

const resolveUpdate = <T>(current: T, update: ValueUpdate<T>) =>
  typeof update === "function" ? (update as (current: T) => T)(current) : update

export function createDisplay(options: {
  getPlayer: () => HTMLElement
  resourcesReady: () => boolean
  viewRef: ViewRef
  onManualViewChange?: () => void
  initialState?: Partial<{
    qualityId: number
    renderFrameRateId: number
    splitScreen: boolean
    faceAutoCenter: boolean
  }>
}) {
  const [state, setState] = createStore({
    projectionId: 0,
    qualityId: options.initialState?.qualityId ?? 2,
    renderFrameRateId: options.initialState?.renderFrameRateId ?? 3,
    splitScreen: options.initialState?.splitScreen ?? true,
    faceAutoCenter: options.initialState?.faceAutoCenter ?? true,
  })
  const [fullscreen, setFullscreen] = createSignal(false)

  const setValue = <K extends keyof typeof state>(key: K, update: ValueUpdate<(typeof state)[K]>) => {
    setState((draft) => {
      draft[key] = resolveUpdate(draft[key], update)
    })
  }
  const setProjectionId = (update: ValueUpdate<number>) => {
    const next = resolveUpdate(state.projectionId, update)
    setValue("projectionId", next)
    return next
  }
  const setQualityId = (update: ValueUpdate<number>) => setValue("qualityId", update)
  const setRenderFrameRateId = (update: ValueUpdate<number>) => {
    const next = resolveUpdate(state.renderFrameRateId, update)
    setValue("renderFrameRateId", Math.min(3, Math.max(1, Math.round(next))))
  }
  const setSplitScreen = (update: ValueUpdate<boolean>) => setValue("splitScreen", update)
  const setFaceAutoCenter = (update: ValueUpdate<boolean>) => setValue("faceAutoCenter", update)

  const restoreProjection = (projectionId: number) => {
    setValue("projectionId", projectionId)
  }

  const resetTransientView = () => {
    options.viewRef.current.yaw = 0
    options.viewRef.current.pitch = 0
    options.viewRef.current.forward = DEFAULT_FORWARD
    options.viewRef.current.pausedUntil = performance.now() + 900
  }

  const resetView = () => {
    if (!options.resourcesReady()) return
    resetTransientView()
    options.onManualViewChange?.()
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
    setProjectionId,
    setQualityId,
    setRenderFrameRateId,
    setSplitScreen,
    state,
    toggleFullscreen,
  }

  return {
    changeQualityBy,
    controller,
    faceAutoCenter: () => state.faceAutoCenter,
    projectionId: () => state.projectionId,
    qualityId: () => state.qualityId,
    renderFrameRateId: () => state.renderFrameRateId,
    splitScreen: () => state.splitScreen,
    resetTransientView,
    restoreProjection,
    syncFullscreen,
  }
}
