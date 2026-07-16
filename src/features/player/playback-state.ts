import { PROJECTION_OPTIONS } from "../vr/config"

export type RepeatMode = "off" | "folder" | "file"

export interface GlobalPreferences {
  volume: number
  playbackRate: number
  qualityId: number
  renderFrameRateId: number
  splitScreen: boolean
  faceAutoCenter: boolean
  resumeFaceAutoCenterAfterViewChange: boolean
  autoResumePlayback: boolean
  subtitlesEnabled: boolean
  repeatMode: RepeatMode
}

export interface LastPlayback {
  key: string
  position: number
  projectionId: number
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
  resumeFaceAutoCenterAfterViewChange: true,
  autoResumePlayback: false,
  subtitlesEnabled: true,
  repeatMode: "file",
}

const GLOBAL_PREFERENCES_KEY = "foursmith-vr:preferences"
const LAST_PLAYBACK_KEY = "foursmith-vr:last-playback"
const DATABASE_NAME = "foursmith-vr-playback"
const DATABASE_VERSION = 8
const VIDEO_STATE_STORE_NAME = "video-state"
const UPDATED_AT_INDEX_NAME = "updated-at"
const MAX_VIDEO_STATE_RECORDS = 200
const GLOBAL_PREFERENCE_KEYS = Object.keys(DEFAULT_GLOBAL_PREFERENCES)
const PLAYBACK_KEYS = ["key", "position", "projection"]
const VIDEO_PLAYBACK_KEYS = [...PLAYBACK_KEYS, "updatedAt"]

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

const hasExactKeys = (value: Record<string, unknown>, keys: string[]) => {
  const storedKeys = Object.keys(value)
  return storedKeys.length === keys.length && storedKeys.every(key => keys.includes(key))
}

const isNumberInRange = (value: unknown, min: number, max: number): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= min && value <= max

const isIntegerInRange = (value: unknown, min: number, max: number): value is number =>
  isNumberInRange(value, min, max) && Number.isInteger(value)

const isRepeatMode = (value: unknown): value is RepeatMode =>
  value === "off" || value === "folder" || value === "file"

const validGlobalPreferences = (value: unknown): GlobalPreferences | undefined => {
  if (
    !isRecord(value)
    || !hasExactKeys(value, GLOBAL_PREFERENCE_KEYS)
    || !isNumberInRange(value.volume, 0, 1)
    || !isNumberInRange(value.playbackRate, 0.25, 4)
    || !isIntegerInRange(value.qualityId, 0, 3)
    || !isIntegerInRange(value.renderFrameRateId, 1, 3)
    || typeof value.splitScreen !== "boolean"
    || typeof value.faceAutoCenter !== "boolean"
    || typeof value.resumeFaceAutoCenterAfterViewChange !== "boolean"
    || typeof value.autoResumePlayback !== "boolean"
    || typeof value.subtitlesEnabled !== "boolean"
    || !isRepeatMode(value.repeatMode)
  ) {
    return
  }

  return {
    volume: value.volume,
    playbackRate: value.playbackRate,
    qualityId: value.qualityId,
    renderFrameRateId: value.renderFrameRateId,
    splitScreen: value.splitScreen,
    faceAutoCenter: value.faceAutoCenter,
    resumeFaceAutoCenterAfterViewChange: value.resumeFaceAutoCenterAfterViewChange,
    autoResumePlayback: value.autoResumePlayback,
    subtitlesEnabled: value.subtitlesEnabled,
    repeatMode: value.repeatMode,
  }
}

export function loadGlobalPreferences(storage: Storage = localStorage): GlobalPreferences {
  try {
    const raw = storage.getItem(GLOBAL_PREFERENCES_KEY)
    if (!raw) return { ...DEFAULT_GLOBAL_PREFERENCES }
    const parsed: unknown = JSON.parse(raw)
    return validGlobalPreferences(parsed) ?? { ...DEFAULT_GLOBAL_PREFERENCES }
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

const validPlayback = (value: unknown, keys = PLAYBACK_KEYS): LastPlayback | undefined => {
  if (!isRecord(value) || !hasExactKeys(value, keys)) return
  const projectionId = PROJECTION_OPTIONS.findIndex(option => option.component === value.projection)
  if (
    typeof value.key !== "string"
    || !value.key
    || typeof value.position !== "number"
    || !Number.isFinite(value.position)
    || value.position < 0
    || projectionId < 0
    || projectionId >= PROJECTION_OPTIONS.length
  ) {
    return
  }
  return { key: value.key, position: value.position, projectionId }
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
    storage.setItem(LAST_PLAYBACK_KEY, JSON.stringify({
      key: playback.key,
      position: playback.position,
      projection: PROJECTION_OPTIONS[playback.projectionId]?.component,
    }))
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
  const playback = validPlayback(value, VIDEO_PLAYBACK_KEYS)
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
    store.put({
      key: state.key,
      position: state.position,
      updatedAt: state.updatedAt,
      projection: PROJECTION_OPTIONS[state.projectionId]?.component,
    })
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
