const DATABASE_NAME = "foursmith-vr"
const DATABASE_VERSION = 2
const STORE_NAME = "volume-waveforms"
const POSITION_STORE_NAME = "playback-positions"

interface CachedWaveform {
  amplitudes: number[]
  updatedAt: number
}

const openDatabase = () => new Promise<IDBDatabase>((resolve, reject) => {
  const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
  request.onupgradeneeded = () => {
    if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME)
    if (!request.result.objectStoreNames.contains(POSITION_STORE_NAME)) request.result.createObjectStore(POSITION_STORE_NAME)
  }
  request.onsuccess = () => resolve(request.result)
  request.onerror = () => reject(request.error)
})

export function waveformCacheKey(resource: { name: string, file?: File, url?: string }) {
  return resource.file
    ? `file:${resource.file.name}:${resource.file.size}:${resource.file.lastModified}`
    : `url:${resource.url ?? resource.name}`
}

export async function loadCachedWaveform(key: string) {
  const database = await openDatabase()
  try {
    return await new Promise<number[] | undefined>((resolve, reject) => {
      const request = database.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(key)
      request.onsuccess = () => resolve((request.result as CachedWaveform | undefined)?.amplitudes)
      request.onerror = () => reject(request.error)
    })
  } finally {
    database.close()
  }
}

export async function saveCachedWaveform(key: string, amplitudes: number[]) {
  const database = await openDatabase()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite")
      transaction.objectStore(STORE_NAME).put({ amplitudes, updatedAt: Date.now() } satisfies CachedWaveform, key)
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
