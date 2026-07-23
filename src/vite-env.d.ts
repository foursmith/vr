/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

declare const __FSVR_VERSION__: string

interface DocumentPictureInPicture {
  requestWindow: (options?: { width?: number, height?: number }) => Promise<Window>
}

interface Window {
  readonly documentPictureInPicture?: DocumentPictureInPicture
}
