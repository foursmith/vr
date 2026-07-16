import type { VrSceneController } from "../../../vr/scene"
import type { AbExportFormat } from "./format"
import { createStore } from "solid-js"
import { chooseAbExportMimeType, getAbExportFormat } from "./format"
import { createSubtitleCompositor } from "./subtitle-compositor"

export { AB_EXPORT_FORMAT_OPTIONS } from "./format"
export type { AbExportFormat } from "./format"

export const MAX_AB_EXPORT_DURATION_SECONDS = 60

type AbExportStatus = "idle" | "recording" | "done" | "error"
type CapturableVideoElement = HTMLVideoElement & {
  captureStream?: () => MediaStream
  mozCaptureStream?: () => MediaStream
}

const exportBaseName = (sourceName: string, start: number, end: number) => {
  const stem = sourceName.replace(/\.[^.]+$/, "").replace(/[\\/:*?"<>|]+/g, "-").trim() || "video"
  const time = (value: number) => value.toFixed(1).replace(".", "-")
  return `${stem}-AB-${time(start)}-${time(end)}`
}
export interface AbLoopExporterOptions {
  getVideo: () => HTMLVideoElement
  getScene: () => VrSceneController | undefined
  getMount: () => HTMLElement
  getFileName: () => string | undefined
  getFrameRate: () => number
  getVideoBitRate: () => number
  getSubtitleText: (time: number) => string
  hasSubtitles: () => boolean
  setCurrentTime: (time: number) => void
}

export const createAbLoopExporter = (options: AbLoopExporterOptions) => {
  const [state, setState] = createStore({
    status: "idle" as AbExportStatus,
    progress: 0,
    message: undefined as string | undefined,
    format: "webm" as AbExportFormat,
  })
  let exporting = false

  const reset = () => setState((draft) => {
    draft.status = "idle"
    draft.progress = 0
    draft.message = undefined
  })

  const exportLoop = async (start: number, end: number, format: AbExportFormat = state.format) => {
    if (exporting) return
    const video = options.getVideo()
    const formatDefinition = getAbExportFormat(format)
    const clipDuration = end - start
    if (!(clipDuration > 0) || clipDuration > MAX_AB_EXPORT_DURATION_SECONDS) {
      setState((draft) => {
        draft.status = "error"
        draft.message = `AB clips must be ${MAX_AB_EXPORT_DURATION_SECONDS} seconds or shorter.`
      })
      return
    }

    const scene = options.getScene()
    const outputCanvas = scene?.getOutputCanvas()
    if (!scene || !outputCanvas?.captureStream) {
      setState((draft) => {
        draft.status = "error"
        draft.message = "This browser cannot export the current view."
      })
      return
    }
    if (!chooseAbExportMimeType(format)) {
      setState((draft) => {
        draft.status = "error"
        draft.message = `${formatDefinition.label} export is not supported by this browser.`
      })
      return
    }

    const previousTime = video.currentTime
    const previousRate = video.playbackRate
    const wasPaused = video.paused
    let recorder: MediaRecorder | undefined
    let capturedStreams: MediaStream[] = []
    let animationFrame: number | undefined
    let timeout: number | undefined
    let finishing = false
    let timedOut = false
    let removeCaptureListeners: (() => void) | undefined
    let subtitleCompositor: ReturnType<typeof createSubtitleCompositor> | undefined

    exporting = true
    setState((draft) => {
      draft.status = "recording"
      draft.progress = 0
      draft.message = `Exporting ${formatDefinition.label}…`
      draft.format = format
    })

    try {
      video.pause()
      video.playbackRate = 1
      video.currentTime = start
      options.setCurrentTime(start)

      if (video.seeking) {
        await new Promise<void>((resolve, reject) => {
          let timer: number
          let handleSeeked: () => void
          let handleError: () => void
          const cleanup = () => {
            window.clearTimeout(timer)
            video.removeEventListener("seeked", handleSeeked)
            video.removeEventListener("error", handleError)
          }
          handleSeeked = () => {
            cleanup()
            resolve()
          }
          handleError = () => {
            cleanup()
            reject(new Error("The video could not seek to point A."))
          }
          timer = window.setTimeout(() => {
            cleanup()
            reject(new Error("Timed out while preparing the clip."))
          }, 5_000)
          video.addEventListener("seeked", handleSeeked, { once: true })
          video.addEventListener("error", handleError, { once: true })
        })
      }

      if (options.hasSubtitles()) {
        subtitleCompositor = createSubtitleCompositor({
          scene,
          sourceCanvas: outputCanvas,
          mount: options.getMount(),
          getText: () => options.getSubtitleText(video.currentTime),
        })
      }
      const captureCanvas = subtitleCompositor?.canvas ?? outputCanvas
      const preparedFormat = await formatDefinition.prepareCapture(captureCanvas)
      const chunks: Blob[] = []
      const viewStream = captureCanvas.captureStream(options.getFrameRate())
      const capturableVideo = video as CapturableVideoElement
      const captureAudio = capturableVideo.captureStream ?? capturableVideo.mozCaptureStream
      const audioStream = captureAudio?.call(capturableVideo)
      capturedStreams = audioStream ? [viewStream, audioStream] : [viewStream]
      const stream = new MediaStream([
        ...viewStream.getVideoTracks(),
        ...(audioStream?.getAudioTracks() ?? []),
      ])
      if (!stream.getVideoTracks().length) throw new Error("The current view could not be captured.")
      const mimeType = chooseAbExportMimeType(format)
      recorder = new MediaRecorder(stream, {
        ...(mimeType ? { mimeType } : {}),
        videoBitsPerSecond: options.getVideoBitRate(),
        audioBitsPerSecond: 128_000,
      })
      const recordingComplete = new Promise<void>((resolve, reject) => {
        recorder!.addEventListener("dataavailable", (event: BlobEvent) => {
          if (event.data.size) chunks.push(event.data)
        })
        recorder!.addEventListener("stop", () => resolve(), { once: true })
        recorder!.addEventListener("error", () => reject(new Error("The browser could not encode this clip.")), { once: true })
      })
      const finishRecording = () => {
        if (finishing) return
        finishing = true
        video.pause()
        if (video.currentTime > end) video.currentTime = end
        options.setCurrentTime(Math.min(video.currentTime, end))
        if (recorder?.state !== "inactive") recorder?.stop()
      }
      const updateProgress = () => {
        const progress = Math.min(100, Math.max(0, ((video.currentTime - start) / clipDuration) * 100))
        setState((draft) => {
          draft.progress = Math.round(progress)
        })
        if (video.currentTime >= end || video.ended) {
          finishRecording()
          return
        }
        animationFrame = window.requestAnimationFrame(updateProgress)
      }
      const handleTimeUpdate = () => {
        if (video.currentTime >= end) finishRecording()
      }
      video.addEventListener("timeupdate", handleTimeUpdate)
      video.addEventListener("ended", finishRecording)
      removeCaptureListeners = () => {
        video.removeEventListener("timeupdate", handleTimeUpdate)
        video.removeEventListener("ended", finishRecording)
      }
      timeout = window.setTimeout(() => {
        timedOut = true
        finishRecording()
      }, (clipDuration + 8) * 1_000)

      recorder.start(1_000)
      animationFrame = window.requestAnimationFrame(updateProgress)
      try {
        await video.play()
      } catch (error) {
        finishRecording()
        throw error
      }
      await recordingComplete

      removeCaptureListeners()
      removeCaptureListeners = undefined
      if (timedOut) throw new Error("Export timed out before reaching point B.")
      const videoBlob = new Blob(chunks, { type: recorder.mimeType || formatDefinition.recordingMimeType })
      if (!videoBlob.size) throw new Error("The exported clip was empty.")
      const baseName = exportBaseName(options.getFileName() ?? "video", start, end)
      const blob = await formatDefinition.finalize(videoBlob, preparedFormat)
      const name = `${baseName}.${formatDefinition.extension}`
      const url = URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = url
      link.download = name
      link.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000)
      setState((draft) => {
        draft.status = "done"
        draft.progress = 100
        draft.message = `Saved ${name}`
      })
    } catch (error) {
      console.warn("AB clip export failed", error)
      setState((draft) => {
        draft.status = "error"
        draft.message = error instanceof Error ? error.message : "The clip could not be exported."
      })
    } finally {
      if (animationFrame !== undefined) window.cancelAnimationFrame(animationFrame)
      if (timeout !== undefined) window.clearTimeout(timeout)
      subtitleCompositor?.destroy()
      removeCaptureListeners?.()
      if (recorder && recorder.state !== "inactive") recorder.stop()
      new Set(capturedStreams.flatMap(captured => captured.getTracks())).forEach(track => track.stop())
      video.playbackRate = previousRate
      video.currentTime = previousTime
      options.setCurrentTime(previousTime)
      exporting = false
      if (!wasPaused) void video.play()
    }
  }

  return {
    state,
    exportFormatSupported: (format: AbExportFormat) => Boolean(chooseAbExportMimeType(format)),
    exportLoop,
    isExporting: () => exporting,
    reset,
  }
}
