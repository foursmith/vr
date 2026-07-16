import { indexedDB } from "fake-indexeddb"
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { fsvrMediaIdentity } from "../fsvr"
import {
  DEFAULT_GLOBAL_PREFERENCES,
  loadGlobalPreferences,
  loadLastPlayback,
  loadVideoPlaybackState,
  saveGlobalPreferences,
  saveLastPlayback,
  saveVideoPlaybackState,
  videoStateKey,
} from "./playback-state"

describe("player state persistence", () => {
  beforeAll(() => vi.stubGlobal("indexedDB", indexedDB))
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

  it("saves the last playback position separately from global preferences", () => {
    const playback = { key: "url:movie.mp4", position: 18.5, projectionId: 2 }
    saveLastPlayback(playback)
    expect(loadLastPlayback()).toEqual(playback)
  })

  it("rejects playback snapshots using removed projection fields", () => {
    localStorage.setItem("foursmith-vr:last-playback", JSON.stringify({
      key: "url:movie.mp4",
      position: 18.5,
      presetId: 2,
    }))
    expect(loadLastPlayback()).toBeUndefined()
  })

  it.each([
    { key: "", position: 18.5, projection: "tb_360_eqr" },
    { key: "url:movie.mp4", projection: "tb_360_eqr" },
    { key: "url:movie.mp4", position: Number.NaN, projection: "tb_360_eqr" },
    { key: "url:movie.mp4", position: -1, projection: "tb_360_eqr" },
    { key: "url:movie.mp4", position: 18.5 },
    { key: "url:movie.mp4", position: 18.5, projection: "unknown" },
    { key: "url:movie.mp4", position: 18.5, projection: "tb_360_eqr", projectionId: 2 },
  ])("rejects an invalid last playback snapshot", (playback) => {
    localStorage.setItem("foursmith-vr:last-playback", JSON.stringify(playback))
    expect(loadLastPlayback()).toBeUndefined()
  })

  it("round-trips one aggregated record for a video", async () => {
    const state = {
      key: "url:https://example.com/movie.mp4",
      updatedAt: 42,
      position: 73.5,
      projectionId: 2,
    }
    await saveVideoPlaybackState(state)
    expect(await loadVideoPlaybackState(state.key)).toEqual(state)
  })
})
