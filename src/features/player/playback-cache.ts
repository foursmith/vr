const DATABASE_NAME = "foursmith-vr-playback"
const DATABASE_VERSION = 1
const LANDING_STORE_NAME = "seek-landing-counts"
const POSITION_STORE_NAME = "playback-positions"
const PREFERENCES_STORE_NAME = "preferences"
const LAST_VIDEO_KEY = "last-played-video"

const openDatabase = () => new Promise<IDBDatabase>((resolve, reject) => {
  const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
  request.onupgradeneeded = () => {
    if (!request.result.objectStoreNames.contains(LANDING_STORE_NAME)) request.result.createObjectStore(LANDING_STORE_NAME)
    if (!request.result.objectStoreNames.contains(POSITION_STORE_NAME)) request.result.createObjectStore(POSITION_STORE_NAME)
    if (!request.result.objectStoreNames.contains(PREFERENCES_STORE_NAME)) request.result.createObjectStore(PREFERENCES_STORE_NAME)
  }
  request.onsuccess = () => resolve(request.result)
  request.onerror = () => reject(request.error)
})

export function playbackCacheKey(resource: { name: string, file?: File, url?: string }) {
  return resource.file
    ? `file:${resource.file.name}:${resource.file.size}:${resource.file.lastModified}`
    : `url:${resource.url ?? resource.name}`
}

export async function loadCachedSeekLandingCounts(key: string) {
  const database = await openDatabase()
  try {
    return await new Promise<number[] | undefined>((resolve, reject) => {
      const request = database.transaction(LANDING_STORE_NAME, "readonly").objectStore(LANDING_STORE_NAME).get(key)
      request.onsuccess = () => resolve(Array.isArray(request.result) ? request.result : undefined)
      request.onerror = () => reject(request.error)
    })
  } finally {
    database.close()
  }
}

export async function saveCachedSeekLandingCounts(key: string, counts: number[]) {
  const database = await openDatabase()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(LANDING_STORE_NAME, "readwrite")
      transaction.objectStore(LANDING_STORE_NAME).put(counts, key)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    })
  } finally {
    database.close()
  }
}

export async function loadCachedPlaybackPosition(key: string) {
  const database = await openDatabase()
  try {
    return await new Promise<number | undefined>((resolve, reject) => {
      const request = database.transaction(POSITION_STORE_NAME, "readonly").objectStore(POSITION_STORE_NAME).get(key)
      request.onsuccess = () => resolve(typeof request.result === "number" ? request.result : undefined)
      request.onerror = () => reject(request.error)
    })
  } finally {
    database.close()
  }
}

export async function saveCachedPlaybackPosition(key: string, position: number) {
  const database = await openDatabase()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(POSITION_STORE_NAME, "readwrite")
      transaction.objectStore(POSITION_STORE_NAME).put(position, key)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    })
  } finally {
    database.close()
  }
}

export async function loadLastPlayedVideoKey() {
  const database = await openDatabase()
  try {
    return await new Promise<string | undefined>((resolve, reject) => {
      const request = database.transaction(PREFERENCES_STORE_NAME, "readonly").objectStore(PREFERENCES_STORE_NAME).get(LAST_VIDEO_KEY)
      request.onsuccess = () => resolve(typeof request.result === "string" ? request.result : undefined)
      request.onerror = () => reject(request.error)
    })
  } finally {
    database.close()
  }
}

export async function saveLastPlayedVideoKey(key: string) {
  const database = await openDatabase()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(PREFERENCES_STORE_NAME, "readwrite")
      transaction.objectStore(PREFERENCES_STORE_NAME).put(key, LAST_VIDEO_KEY)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    })
  } finally {
    database.close()
  }
}
