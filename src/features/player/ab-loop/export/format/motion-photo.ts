import type { AbExportFormatDefinition } from "./index"

const XMP_NAMESPACE = "http://ns.adobe.com/xap/1.0/\0"

const canvasToJpeg = (canvas: HTMLCanvasElement) => new Promise<Blob>((resolve, reject) => {
  canvas.toBlob((blob) => {
    if (blob) resolve(blob)
    else reject(new Error("The photo cover could not be created."))
  }, "image/jpeg", 0.92)
})

export async function createMotionPhoto(cover: Blob, video: Blob) {
  const coverBytes = new Uint8Array(await cover.arrayBuffer())
  if (coverBytes[0] !== 0xFF || coverBytes[1] !== 0xD8) {
    throw new Error("The Motion Photo cover is not a valid JPEG.")
  }

  const videoSize = video.size
  const xmp = `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Adobe XMP Core 5.1.0-jc003">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about=""
        xmlns:GCamera="http://ns.google.com/photos/1.0/camera/"
        xmlns:OpCamera="http://ns.oplus.com/photos/1.0/camera/"
        xmlns:MiCamera="http://ns.xiaomi.com/photos/1.0/camera/"
        xmlns:Container="http://ns.google.com/photos/1.0/container/"
        xmlns:Item="http://ns.google.com/photos/1.0/container/item/"
      GCamera:MotionPhoto="1"
      GCamera:MotionPhotoVersion="1"
      GCamera:MotionPhotoPresentationTimestampUs="0"
      OpCamera:MotionPhotoPrimaryPresentationTimestampUs="0"
      OpCamera:MotionPhotoOwner="oplus"
      OpCamera:OLivePhotoVersion="2"
      OpCamera:VideoLength="${videoSize}"
      GCamera:MicroVideoVersion="1"
      GCamera:MicroVideo="1"
      GCamera:MicroVideoOffset="${videoSize}"
      GCamera:MicroVideoPresentationTimestampUs="0"
      MiCamera:XMPMeta="&lt;?xml version='1.0' encoding='UTF-8' standalone='yes' ?&gt;">
      <Container:Directory>
        <rdf:Seq>
          <rdf:li rdf:parseType="Resource">
            <Container:Item
              Item:Mime="image/jpeg"
              Item:Semantic="Primary"
              Item:Length="0"
              Item:Padding="0"/>
          </rdf:li>
          <rdf:li rdf:parseType="Resource">
            <Container:Item
              Item:Mime="video/mp4"
              Item:Semantic="MotionPhoto"
              Item:Length="${videoSize}"/>
          </rdf:li>
        </rdf:Seq>
      </Container:Directory>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`
  const xmpBytes = new TextEncoder().encode(XMP_NAMESPACE + xmp)
  if (xmpBytes.length + 2 > 0xFFFF) throw new Error("The Motion Photo metadata is too large.")

  const app1 = new Uint8Array(xmpBytes.length + 4)
  const app1View = new DataView(app1.buffer)
  app1View.setUint16(0, 0xFFE1)
  app1View.setUint16(2, xmpBytes.length + 2)
  app1.set(xmpBytes, 4)

  let insertAt = 2
  if (coverBytes[2] === 0xFF && coverBytes[3] === 0xE0 && coverBytes.length >= 6) {
    const app0Length = (coverBytes[4] << 8) | coverBytes[5]
    const app0End = 4 + app0Length
    if (app0Length >= 2 && app0End <= coverBytes.length) insertAt = app0End
  }

  return new Blob([
    coverBytes.slice(0, insertAt),
    app1,
    coverBytes.slice(insertAt),
    video,
  ], { type: "image/jpeg" })
}

export const MOTION_PHOTO_EXPORT_FORMAT = {
  id: "motion-photo",
  label: "Motion Photo",
  extension: "jpg",
  recordingMimeType: "video/mp4",
  mimeTypes: [
    "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    "video/mp4;codecs=avc1,mp4a.40.2",
    "video/mp4",
  ],
  prepareCapture: async (canvas: HTMLCanvasElement) => {
    await new Promise<void>(resolve => window.requestAnimationFrame(() => resolve()))
    return canvasToJpeg(canvas)
  },
  finalize: (video: Blob, cover?: Blob) => {
    if (!cover) throw new Error("The Motion Photo cover could not be created.")
    return createMotionPhoto(cover, video)
  },
} as const satisfies AbExportFormatDefinition
