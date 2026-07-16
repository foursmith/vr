import { MOTION_PHOTO_EXPORT_FORMAT } from "./motion-photo"
import { MP4_EXPORT_FORMAT } from "./mp4"
import { WEBM_EXPORT_FORMAT } from "./webm"

export type AbExportFormat = "webm" | "mp4" | "motion-photo"

export interface AbExportFormatDefinition {
  id: AbExportFormat
  label: string
  extension: string
  recordingMimeType: string
  mimeTypes: readonly string[]
  prepareCapture: (canvas: HTMLCanvasElement) => Promise<Blob | undefined>
  finalize: (video: Blob, prepared?: Blob) => Promise<Blob>
}

const FORMAT_DEFINITIONS: Record<AbExportFormat, AbExportFormatDefinition> = {
  "webm": WEBM_EXPORT_FORMAT,
  "mp4": MP4_EXPORT_FORMAT,
  "motion-photo": MOTION_PHOTO_EXPORT_FORMAT,
}

export const AB_EXPORT_FORMAT_OPTIONS = Object.values(FORMAT_DEFINITIONS).map(format => ({
  label: format.label,
  value: format.id,
}))

export const getAbExportFormat = (format: AbExportFormat) => FORMAT_DEFINITIONS[format]

export const chooseAbExportMimeType = (format: AbExportFormat) => {
  if (typeof MediaRecorder === "undefined") return
  return getAbExportFormat(format).mimeTypes.find(type => MediaRecorder.isTypeSupported(type))
}
