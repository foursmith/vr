import type { ValueUpdate } from "../../lib/value-update"
import type { CameraView } from "../vr/config"
import { createSignal, createStore } from "solid-js"
import { resolveValueUpdate } from "../../lib/value-update"
import { DEFAULT_FORWARD, QUALITY_OPTIONS } from "../vr/config"

interface ViewRef { current: CameraView }

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
    resumeFaceAutoCenterAfterViewChange: boolean
  }>
}) {
  const [state, setState] = createStore({
    projectionId: 0,
    qualityId: options.initialState?.qualityId ?? 2,
    renderFrameRateId: options.initialState?.renderFrameRateId ?? 3,
    splitScreen: options.initialState?.splitScreen ?? true,
    faceAutoCenter: options.initialState?.faceAutoCenter ?? true,
    resumeFaceAutoCenterAfterViewChange: options.initialState?.resumeFaceAutoCenterAfterViewChange ?? true,
  })
  const [fullscreen, setFullscreen] = createSignal(false)

  const setValue = <K extends keyof typeof state>(key: K, update: ValueUpdate<(typeof state)[K]>) => {
    setState((draft) => {
      draft[key] = resolveValueUpdate(draft[key], update)
    })
  }
  const setProjectionId = (update: ValueUpdate<number>) => {
    const next = resolveValueUpdate(state.projectionId, update)
    setValue("projectionId", next)
    return next
  }
  const setQualityId = (update: ValueUpdate<number>) => setValue("qualityId", update)
  const setRenderFrameRateId = (update: ValueUpdate<number>) => {
    const next = resolveValueUpdate(state.renderFrameRateId, update)
    setValue("renderFrameRateId", Math.min(3, Math.max(1, Math.round(next))))
  }
  const setSplitScreen = (update: ValueUpdate<boolean>) => setValue("splitScreen", update)
  const setFaceAutoCenter = (update: ValueUpdate<boolean>) => setValue("faceAutoCenter", update)
  const setResumeFaceAutoCenterAfterViewChange = (update: ValueUpdate<boolean>) =>
    setValue("resumeFaceAutoCenterAfterViewChange", update)

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
    setResumeFaceAutoCenterAfterViewChange,
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
    resumeFaceAutoCenterAfterViewChange: () => state.resumeFaceAutoCenterAfterViewChange,
    splitScreen: () => state.splitScreen,
    resetTransientView,
    restoreProjection,
    syncFullscreen,
  }
}
