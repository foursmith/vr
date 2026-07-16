const FSVR_MEDIA_PATH = /^\/api\/v1\/media\/([^/]+)\/([^/]+)$/
const FSVR_KEY = /^fsvr:([^/]+)\/([^/]+)$/

export interface FsvrMediaIdentity { sourceId: string, entryId: string }

export function fsvrMediaIdentity(keyOrUrl: string): FsvrMediaIdentity | undefined {
  try {
    const value = keyOrUrl.startsWith("url:") ? keyOrUrl.slice(4) : keyOrUrl
    const match = FSVR_KEY.exec(keyOrUrl) ?? FSVR_MEDIA_PATH.exec(new URL(value).pathname)
    if (!match) return
    return { sourceId: decodeURIComponent(match[1]), entryId: decodeURIComponent(match[2]) }
  } catch {
    // Invalid URLs and percent encoding are not fsvr media identities.
  }
}

export const fsvrMediaKey = (identity: FsvrMediaIdentity) =>
  `fsvr:${encodeURIComponent(identity.sourceId)}/${encodeURIComponent(identity.entryId)}`

const decodeBase64Url = (value: string) => {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/")
  const bytes = Uint8Array.from(
    atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "=")),
    character => character.charCodeAt(0),
  )
  return new TextDecoder().decode(bytes)
}

const encodeBase64Url = (value: string) => {
  let binary = ""
  new TextEncoder().encode(value).forEach(byte => (binary += String.fromCharCode(byte)))
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "")
}

export const localFsvrVideoLocation = (entryId: string) => {
  try {
    const path = decodeBase64Url(entryId)
    const separator = path.includes("\\") && !path.includes("/") ? "\\" : "/"
    const parts = path.split(/[\\/]/).filter(Boolean)
    const name = parts.pop()
    if (!name) return
    let parentPath = ""
    const folderIds = ["source:local", ...parts.map((part) => {
      parentPath = parentPath ? `${parentPath}${separator}${part}` : part
      return `local:${encodeBase64Url(parentPath)}`
    })]
    return { folderIds, name }
  } catch {
    // Ignore malformed local entry IDs from stale playback data.
  }
}
