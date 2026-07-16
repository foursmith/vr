import type { AbExportFormatDefinition } from "../format"

export const MP4_EXPORT_FORMAT = {
  id: "mp4",
  label: "MP4",
  extension: "mp4",
  recordingMimeType: "video/mp4",
  mimeTypes: [
    "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    "video/mp4;codecs=avc1,mp4a.40.2",
    "video/mp4",
  ],
  prepareCapture: async () => undefined,
  finalize: async (video: Blob) => video,
} as const satisfies AbExportFormatDefinition
