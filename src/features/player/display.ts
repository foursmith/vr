import { createSignal, createStore } from 'solid-js'
import { DEFAULT_ZOOM, QUALITY_OPTIONS, type CameraView } from '../vr/scene'

type ValueUpdate<T> = T | ((current: T) => T)
type ViewRef = { current: CameraView }

const resolveUpdate = <T>(current: T, update: ValueUpdate<T>) =>
  typeof update === 'function' ? (update as (current: T) => T)(current) : update

export function createDisplay(options: {
  getPlayer: () => HTMLElement
  resourcesReady: () => boolean
  viewRef: ViewRef
}) {
  const [state, setState] = createStore({
    presetId: 0,
    qualityId: 2,
    splitScreen: true,
    faceAutoCenter: true,
  })
  const [zoom, setZoomSignal] = createSignal(DEFAULT_ZOOM)
  const [fullscreen, setFullscreen] = createSignal(false)

  const setValue = <K extends keyof typeof state>(key: K, update: ValueUpdate<(typeof state)[K]>) => {
    setState((draft) => {
      draft[key] = resolveUpdate(draft[key], update)
    })
  }
  const setPresetId = (update: ValueUpdate<number>) => setValue('presetId', update)
  const setQualityId = (update: ValueUpdate<number>) => setValue('qualityId', update)
  const setSplitScreen = (update: ValueUpdate<boolean>) => setValue('splitScreen', update)
  const setFaceAutoCenter = (update: ValueUpdate<boolean>) => setValue('faceAutoCenter', update)

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

  const resetView = () => {
    if (!options.resourcesReady()) return
    options.viewRef.current.yaw = 0
    options.viewRef.current.pitch = 0
    options.viewRef.current.zoom = DEFAULT_ZOOM
    options.viewRef.current.pausedUntil = performance.now() + 900
    setZoomSignal(DEFAULT_ZOOM)
  }

  const changeQualityBy = (amount: number) => {
    if (!options.resourcesReady()) return
    setQualityId((current) => Math.min(QUALITY_OPTIONS.length - 1, Math.max(0, current + amount)))
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
      console.warn('fullscreen toggle failed', error)
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
    splitScreen: () => state.splitScreen,
    syncFullscreen,
    syncZoom,
  }
}
