import type { AbExportFormat, AbLoopExporterOptions } from "./export"
import { createStore } from "solid-js"
import { createAbLoopExporter } from "./export"

export interface AbLoopControllerOptions extends AbLoopExporterOptions {
  getDuration: () => number
  hasVideo: () => boolean
}

export const createAbLoopController = (options: AbLoopControllerOptions) => {
  const [loop, setLoop] = createStore({
    a: undefined as number | undefined,
    b: undefined as number | undefined,
  })
  const exporter = createAbLoopExporter(options)

  const reset = () => {
    setLoop((draft) => {
      draft.a = undefined
      draft.b = undefined
    })
    exporter.reset()
  }

  const setStart = () => {
    const video = options.getVideo()
    if (!options.hasVideo() || !Number.isFinite(video.currentTime)) return
    const time = Math.min(options.getDuration() || video.currentTime, Math.max(0, video.currentTime))
    setLoop((draft) => {
      draft.a = time
      draft.b = undefined
    })
    exporter.reset()
  }

  const setEnd = () => {
    const video = options.getVideo()
    if (!options.hasVideo() || loop.a === undefined || !Number.isFinite(video.currentTime)) return
    const time = Math.min(options.getDuration() || video.currentTime, Math.max(0, video.currentTime))
    setLoop((draft) => {
      if (draft.a !== undefined && time > draft.a) draft.b = time
    })
    exporter.reset()
  }

  const syncPlaybackTime = (time: number) => {
    if (exporter.isExporting() || loop.a === undefined || loop.b === undefined || time < loop.b) return false
    const video = options.getVideo()
    video.currentTime = loop.a
    options.setCurrentTime(loop.a)
    if (video.paused) void video.play()
    return true
  }

  const replay = () => {
    const video = options.getVideo()
    video.currentTime = loop.a ?? 0
    options.setCurrentTime(video.currentTime)
    void video.play()
  }

  const exportLoop = (format: AbExportFormat = exporter.state.format) => {
    if (loop.a === undefined || loop.b === undefined) return Promise.resolve()
    return exporter.exportLoop(loop.a, loop.b, format)
  }

  return {
    loop,
    exportState: exporter.state,
    clear: reset,
    exportFormatSupported: exporter.exportFormatSupported,
    exportLoop,
    hasLoop: () => loop.a !== undefined && loop.b !== undefined,
    replay,
    reset,
    setEnd,
    setStart,
    syncPlaybackTime,
  }
}
