import { PROJECTION_OPTIONS } from "../vr/config"

export interface LastPlayback {
  key: string
  position: number
  projectionId: number
}

export interface VideoPlaybackState extends LastPlayback {
  updatedAt: number
}

const LAST_PLAYBACK_KEY = "foursmith-vr:playback:last-key"
const PENDING_PLAYBACK_KEY = "foursmith-vr:playback:pending"
const DATABASE_NAME = "foursmith-vr-playback-history"
const DATABASE_VERSION = 1
const VIDEO_STATE_STORE_NAME = "video-state"
const UPDATED_AT_INDEX_NAME = "updated-at"
const MAX_VIDEO_STATE_RECORDS = 10_000
const PRUNE_AFTER_WRITES = 100

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

const playbackStateFromStorage = (value: unknown): VideoPlaybackState | undefined => {
  if (!isRecord(value)) return
  const projectionId = PROJECTION_OPTIONS.findIndex(option => option.component === value.projection)
  if (
    typeof value.key !== "string"
    || !value.key
    || typeof value.position !== "number"
    || !Number.isFinite(value.position)
    || value.position < 0
    || typeof value.updatedAt !== "number"
    || !Number.isFinite(value.updatedAt)
    || value.updatedAt < 0
    || projectionId < 0
  ) {
    return
  }
  return { key: value.key, position: value.position, projectionId, updatedAt: value.updatedAt }
}

const storedPlayback = (playback: VideoPlaybackState) => ({
  key: playback.key,
  position: playback.position,
  projection: PROJECTION_OPTIONS[playback.projectionId]?.component,
  updatedAt: playback.updatedAt,
})

export function loadLastPlaybackKey(storage: Storage = localStorage) {
  try {
    const key = storage.getItem(LAST_PLAYBACK_KEY)
    return key || undefined
  } catch (error) {
    console.warn("last playback key could not be loaded", error)
  }
}

export function saveLastPlaybackKey(key: string, storage: Storage = localStorage) {
  try {
    storage.setItem(LAST_PLAYBACK_KEY, key)
  } catch (error) {
    console.warn("last playback key could not be saved", error)
  }
}

export function loadPendingPlayback(storage: Storage = localStorage) {
  try {
    const raw = storage.getItem(PENDING_PLAYBACK_KEY)
    if (!raw) return
    return playbackStateFromStorage(JSON.parse(raw))
  } catch (error) {
    console.warn("pending playback could not be loaded", error)
  }
}

export function savePendingPlayback(playback: LastPlayback | VideoPlaybackState, storage: Storage = localStorage) {
  const checkpoint = {
    ...playback,
    updatedAt: "updatedAt" in playback ? playback.updatedAt : Date.now(),
  }
  try {
    storage.setItem(PENDING_PLAYBACK_KEY, JSON.stringify(storedPlayback(checkpoint)))
    storage.setItem(LAST_PLAYBACK_KEY, checkpoint.key)
  } catch (error) {
    console.warn("pending playback could not be saved", error)
  }
}

export function remapLastPlaybackKey(key: string, storage: Storage = localStorage) {
  const previousKey = loadLastPlaybackKey(storage)
  const pending = loadPendingPlayback(storage)
  if (pending && previousKey && pending.key === previousKey) savePendingPlayback({ ...pending, key }, storage)
  else saveLastPlaybackKey(key, storage)
}

const clearPendingPlaybackThrough = (state: VideoPlaybackState, storage: Storage) => {
  const pending = loadPendingPlayback(storage)
  if (pending?.key === state.key && pending.updatedAt <= state.updatedAt) {
    storage.removeItem(PENDING_PLAYBACK_KEY)
  }
}

let databasePromise: Promise<IDBDatabase> | undefined
let writesUntilPrune = PRUNE_AFTER_WRITES

const openDatabase = () => {
  if (databasePromise) return databasePromise
  databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
    request.onupgradeneeded = () => {
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

export async function loadVideoPlaybackState(key: string) {
  const database = await openDatabase()
  return new Promise<VideoPlaybackState | undefined>((resolve, reject) => {
    const request = database.transaction(VIDEO_STATE_STORE_NAME, "readonly").objectStore(VIDEO_STATE_STORE_NAME).get(key)
    request.onsuccess = () => resolve(playbackStateFromStorage(request.result))
    request.onerror = () => reject(request.error)
  })
}

export async function saveVideoPlaybackState(state: VideoPlaybackState) {
  const database = await openDatabase()
  return new Promise<VideoPlaybackState>((resolve, reject) => {
    const transaction = database.transaction(VIDEO_STATE_STORE_NAME, "readwrite")
    const store = transaction.objectStore(VIDEO_STATE_STORE_NAME)
    let resolvedState = state
    const currentRequest = store.get(state.key)
    currentRequest.onsuccess = () => {
      const current = playbackStateFromStorage(currentRequest.result)
      if (current && current.updatedAt > state.updatedAt) {
        resolvedState = current
        return
      }
      store.put(storedPlayback(state))
      writesUntilPrune -= 1
      if (writesUntilPrune > 0) return
      writesUntilPrune = PRUNE_AFTER_WRITES
      const countRequest = store.count()
      countRequest.onsuccess = () => {
        let excess = countRequest.result - MAX_VIDEO_STATE_RECORDS
        if (excess <= 0) return
        const cursorRequest = store.index(UPDATED_AT_INDEX_NAME).openKeyCursor()
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result
          if (!cursor || excess <= 0) return
          store.delete(cursor.primaryKey)
          excess -= 1
          cursor.continue()
        }
      }
    }
    transaction.oncomplete = () => resolve(resolvedState)
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
  })
}

export async function persistVideoPlaybackState(state: VideoPlaybackState, storage: Storage = localStorage) {
  const persisted = await saveVideoPlaybackState(state)
  clearPendingPlaybackThrough(persisted, storage)
  return persisted
}

export async function flushPendingPlayback(storage: Storage = localStorage) {
  const pending = loadPendingPlayback(storage)
  if (pending) await persistVideoPlaybackState(pending, storage)
}

export async function resolveVideoPlaybackState(key: string, storage: Storage = localStorage) {
  const pending = loadPendingPlayback(storage)
  let stored: VideoPlaybackState | undefined
  try {
    stored = await loadVideoPlaybackState(key)
  } catch (error) {
    if (pending?.key === key) return pending
    throw error
  }
  if (pending?.key !== key) return stored
  if (stored && stored.updatedAt > pending.updatedAt) {
    clearPendingPlaybackThrough(stored, storage)
    return stored
  }
  try {
    return await persistVideoPlaybackState(pending, storage)
  } catch {
    return pending
  }
}
