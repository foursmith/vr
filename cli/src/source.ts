export interface MediaEntry {
  id: string
  name: string
  kind: "folder" | "video" | "subtitle"
  size?: number
  modifiedAt?: string
}

export interface MediaSource {
  id: string
  name: string
  kind: "dlna" | "local"
  list: (path: string) => Promise<MediaEntry[]>
  resolve: (id: string) => Promise<MediaResource>
}

export type MediaResource
  = | { kind: "file", path: string }
    | { kind: "url", url: string, mimeType?: string }
