import type { AbExportFormatDefinition } from "../format"

export const WEBM_EXPORT_FORMAT = {
  id: "webm",
  label: "WebM",
  extension: "webm",
  recordingMimeType: "video/webm",
  mimeTypes: [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ],
  prepareCapture: async () => undefined,
  finalize: async (video: Blob) => video,
} as const satisfies AbExportFormatDefinition
