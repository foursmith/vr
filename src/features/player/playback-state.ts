export type RepeatMode = "off" | "folder" | "file"

export interface GlobalPreferences {
  volume: number
  playbackRate: number
  qualityId: number
  renderFrameRateId: number
  splitScreen: boolean
  faceAutoCenter: boolean
  subtitlesEnabled: boolean
  repeatMode: RepeatMode
}

export interface LastPlayback {
  key: string
  position: number
  presetId: number
}

export interface VideoPlaybackState extends LastPlayback {
  updatedAt: number
}

export const DEFAULT_GLOBAL_PREFERENCES: GlobalPreferences = {
  volume: 1,
  playbackRate: 1,
  qualityId: 2,
  renderFrameRateId: 3,
  splitScreen: true,
  faceAutoCenter: true,
  subtitlesEnabled: true,
  repeatMode: "off",
}

const GLOBAL_PREFERENCES_KEY = "foursmith-vr:preferences"
const LAST_PLAYBACK_KEY = "foursmith-vr:last-playback"
const DATABASE_NAME = "foursmith-vr-playback"
const DATABASE_VERSION = 8
const VIDEO_STATE_STORE_NAME = "video-state"
const UPDATED_AT_INDEX_NAME = "updated-at"
const MAX_VIDEO_STATE_RECORDS = 200

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

const numberInRange = (value: unknown, fallback: number, min: number, max: number) =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback

const booleanOr = (value: unknown, fallback: boolean) => typeof value === "boolean" ? value : fallback

const isRepeatMode = (value: unknown): value is RepeatMode =>
  value === "off" || value === "folder" || value === "file"

const repeatModeFromStorage = (value: unknown): RepeatMode =>
  value === "playlist" ? "folder" : isRepeatMode(value) ? value : DEFAULT_GLOBAL_PREFERENCES.repeatMode

export function loadGlobalPreferences(storage: Storage = localStorage): GlobalPreferences {
  try {
    const raw = storage.getItem(GLOBAL_PREFERENCES_KEY)
    if (!raw) return { ...DEFAULT_GLOBAL_PREFERENCES }
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed)) return { ...DEFAULT_GLOBAL_PREFERENCES }
    return {
      volume: numberInRange(parsed.volume, DEFAULT_GLOBAL_PREFERENCES.volume, 0, 1),
      playbackRate: numberInRange(parsed.playbackRate, DEFAULT_GLOBAL_PREFERENCES.playbackRate, 0.25, 4),
      qualityId: Math.round(numberInRange(parsed.qualityId, DEFAULT_GLOBAL_PREFERENCES.qualityId, 0, 3)),
      renderFrameRateId: Math.round(numberInRange(parsed.renderFrameRateId, DEFAULT_GLOBAL_PREFERENCES.renderFrameRateId, 1, 3)),
      splitScreen: booleanOr(parsed.splitScreen, DEFAULT_GLOBAL_PREFERENCES.splitScreen),
      faceAutoCenter: booleanOr(parsed.faceAutoCenter, DEFAULT_GLOBAL_PREFERENCES.faceAutoCenter),
      subtitlesEnabled: booleanOr(parsed.subtitlesEnabled, DEFAULT_GLOBAL_PREFERENCES.subtitlesEnabled),
      repeatMode: repeatModeFromStorage(parsed.repeatMode),
    }
  } catch (error) {
    console.warn("global preferences could not be loaded", error)
    return { ...DEFAULT_GLOBAL_PREFERENCES }
  }
}

export function saveGlobalPreferences(preferences: GlobalPreferences, storage: Storage = localStorage) {
  try {
    storage.setItem(GLOBAL_PREFERENCES_KEY, JSON.stringify(preferences))
  } catch (error) {
    console.warn("global preferences could not be saved", error)
  }
}

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

const fsvrMediaKey = (identity: FsvrMediaIdentity) =>
  `fsvr:${encodeURIComponent(identity.sourceId)}/${encodeURIComponent(identity.entryId)}`

export function videoStateKey(resource: { name: string, file?: File, url?: string }) {
  if (resource.file) return `file:${resource.file.name}:${resource.file.size}:${resource.file.lastModified}`
  const identity = resource.url && fsvrMediaIdentity(resource.url)
  return identity ? fsvrMediaKey(identity) : `url:${resource.url ?? resource.name}`
}

const validPlayback = (value: unknown): LastPlayback | undefined => {
  if (
    !isRecord(value)
    || typeof value.key !== "string"
    || !value.key
    || typeof value.position !== "number"
    || !Number.isFinite(value.position)
    || value.position < 0
    || typeof value.presetId !== "number"
    || !Number.isInteger(value.presetId)
    || value.presetId < 0
    || value.presetId > 3
  ) {
    return
  }
  return { key: value.key, position: value.position, presetId: value.presetId }
}

export function loadLastPlayback(storage: Storage = localStorage) {
  try {
    const raw = storage.getItem(LAST_PLAYBACK_KEY)
    if (!raw) return
    const parsed: unknown = JSON.parse(raw)
    return validPlayback(parsed)
  } catch (error) {
    console.warn("last playback could not be loaded", error)
  }
}

export function saveLastPlayback(playback: LastPlayback, storage: Storage = localStorage) {
  try {
    storage.setItem(LAST_PLAYBACK_KEY, JSON.stringify(playback))
  } catch (error) {
    console.warn("last playback could not be saved", error)
  }
}

let databasePromise: Promise<IDBDatabase> | undefined

const openDatabase = () => {
  if (databasePromise) return databasePromise
  databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
    request.onupgradeneeded = () => {
      Array.from(request.result.objectStoreNames).forEach(name => request.result.deleteObjectStore(name))
      const store = request.result.createObjectStore(VIDEO_STATE_STORE_NAME, { keyPath: "key" })
      store.createIndex(UPDATED_AT_INDEX_NAME, "updatedAt")
    }
    request.onsuccess = () => {
      request.result.onversionchange = () => {
        request.result.close()
        databasePromise = undefined
      }
      resolve(request.result)
    }
    request.onerror = () => {
      databasePromise = undefined
      reject(request.error)
    }
  })
  return databasePromise
}

const validVideoPlaybackState = (value: unknown): VideoPlaybackState | undefined => {
  const playback = validPlayback(value)
  if (!playback || !isRecord(value) || typeof value.updatedAt !== "number" || !Number.isFinite(value.updatedAt) || value.updatedAt < 0) return
  return { ...playback, updatedAt: value.updatedAt }
}

export async function loadVideoPlaybackState(key: string) {
  const database = await openDatabase()
  return new Promise<VideoPlaybackState | undefined>((resolve, reject) => {
    const request = database.transaction(VIDEO_STATE_STORE_NAME, "readonly").objectStore(VIDEO_STATE_STORE_NAME).get(key)
    request.onsuccess = () => resolve(validVideoPlaybackState(request.result))
    request.onerror = () => reject(request.error)
  })
}

export async function saveVideoPlaybackState(state: VideoPlaybackState) {
  const database = await openDatabase()
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(VIDEO_STATE_STORE_NAME, "readwrite")
    const store = transaction.objectStore(VIDEO_STATE_STORE_NAME)
    store.put(state)
    const keysRequest = store.index(UPDATED_AT_INDEX_NAME).getAllKeys()
    keysRequest.onsuccess = () => {
      const excess = keysRequest.result.length - MAX_VIDEO_STATE_RECORDS
      if (excess > 0) keysRequest.result.slice(0, excess).forEach(key => store.delete(key))
    }
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
  })
}
