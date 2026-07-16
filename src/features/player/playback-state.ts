import { fsvrMediaIdentity, fsvrMediaKey } from "../fsvr"

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
const GLOBAL_PREFERENCE_KEYS = Object.keys(DEFAULT_GLOBAL_PREFERENCES)

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

export function videoStateKey(resource: { name: string, file?: File, url?: string }) {
  if (resource.file) return `file:${resource.file.name}:${resource.file.size}:${resource.file.lastModified}`
  const identity = resource.url && fsvrMediaIdentity(resource.url)
  return identity ? fsvrMediaKey(identity) : `url:${resource.url ?? resource.name}`
}
