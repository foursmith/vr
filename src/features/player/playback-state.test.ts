import { beforeEach, describe, expect, it, vi } from "vitest"
import { fsvrMediaIdentity } from "../fsvr"
import {
  DEFAULT_GLOBAL_PREFERENCES,
  loadGlobalPreferences,
  saveGlobalPreferences,
  videoStateKey,
} from "./playback-state"

describe("player state persistence", () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it("loads defaults when global preferences are absent or invalid", () => {
    expect(loadGlobalPreferences()).toEqual(DEFAULT_GLOBAL_PREFERENCES)
    expect(loadGlobalPreferences().resumeFaceAutoCenterAfterViewChange).toBe(true)
    localStorage.setItem("foursmith-vr:preferences", "not-json")
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {})
    expect(loadGlobalPreferences()).toEqual(DEFAULT_GLOBAL_PREFERENCES)
    expect(warning).toHaveBeenCalledOnce()
    warning.mockRestore()
  })

  it("rejects preferences that do not match the current schema", () => {
    localStorage.setItem("foursmith-vr:preferences", JSON.stringify({ volume: 0.5 }))
    expect(loadGlobalPreferences()).toEqual(DEFAULT_GLOBAL_PREFERENCES)
  })

  it("rejects invalid preference values instead of normalizing them", () => {
    localStorage.setItem("foursmith-vr:preferences", JSON.stringify({
      ...DEFAULT_GLOBAL_PREFERENCES,
      volume: 5,
    }))
    expect(loadGlobalPreferences()).toEqual(DEFAULT_GLOBAL_PREFERENCES)
  })

  it("rejects preferences containing removed fields", () => {
    localStorage.setItem("foursmith-vr:preferences", JSON.stringify({
      ...DEFAULT_GLOBAL_PREFERENCES,
      faceCenteringMode: "system",
    }))
    expect(loadGlobalPreferences()).toEqual(DEFAULT_GLOBAL_PREFERENCES)
  })

  it("saves global preferences as one value", () => {
    const preferences = { ...DEFAULT_GLOBAL_PREFERENCES, volume: 0.4, repeatMode: "file" as const }
    saveGlobalPreferences(preferences)
    expect(loadGlobalPreferences()).toEqual(preferences)
  })

  it("rejects removed preference values", () => {
    localStorage.setItem("foursmith-vr:preferences", JSON.stringify({
      ...DEFAULT_GLOBAL_PREFERENCES,
      repeatMode: "playlist",
    }))
    expect(loadGlobalPreferences()).toEqual(DEFAULT_GLOBAL_PREFERENCES)
  })

  it("creates stable state keys for files and URLs", () => {
    const file = new File(["video"], "movie.mp4", { lastModified: 42 })
    expect(videoStateKey({ name: file.name, file })).toBe(`file:movie.mp4:${file.size}:42`)
    expect(videoStateKey({ name: "Remote", url: "https://example.com/movie.mp4" })).toBe("url:https://example.com/movie.mp4")
    expect(videoStateKey({ name: "Remote", url: "http://127.0.0.1:4090/api/v1/media/local/folder%2Fmovie" })).toBe("fsvr:local/folder%2Fmovie")
    expect(fsvrMediaIdentity("url:http://localhost:4090/api/v1/media/local/folder%2Fmovie")).toEqual({
      sourceId: "local",
      entryId: "folder/movie",
    })
  })
})
