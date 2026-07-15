import { indexedDB } from "fake-indexeddb"
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import {
  DEFAULT_GLOBAL_PREFERENCES,
  fsvrMediaIdentity,
  loadGlobalPreferences,
  loadLastPlayback,
  loadVideoPlaybackState,
  saveGlobalPreferences,
  saveLastPlayback,
  saveVideoPlaybackState,
  videoStateKey,
} from "../../src/features/player/playback-state"

describe("player state persistence", () => {
  beforeAll(() => vi.stubGlobal("indexedDB", indexedDB))
  beforeEach(() => {
    localStorage.clear()
  })

  it("loads defaults when global preferences are absent or invalid", () => {
    expect(loadGlobalPreferences()).toEqual(DEFAULT_GLOBAL_PREFERENCES)
    localStorage.setItem("foursmith-vr:preferences", "not-json")
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {})
    expect(loadGlobalPreferences()).toEqual(DEFAULT_GLOBAL_PREFERENCES)
    expect(warning).toHaveBeenCalledOnce()
    warning.mockRestore()
  })

  it("validates global preferences at the storage boundary", () => {
    localStorage.setItem("foursmith-vr:preferences", JSON.stringify({
      volume: 5,
      playbackRate: 0,
      qualityId: 2.6,
      renderFrameRateId: 99,
      splitScreen: false,
      faceAutoCenter: false,
      faceCenteringMode: "system",
      subtitlesEnabled: false,
      repeatMode: "folder",
      exportFrameRateId: 0,
      exportQualityId: 1,
    }))
    expect(loadGlobalPreferences()).toEqual({
      volume: 1,
      playbackRate: 0.25,
      qualityId: 3,
      renderFrameRateId: 3,
      splitScreen: false,
      faceAutoCenter: false,
      autoResumePlayback: false,
      subtitlesEnabled: false,
      repeatMode: "folder",
    })
  })

  it("ignores the removed detector mode when migrating preferences", () => {
    localStorage.setItem("foursmith-vr:preferences", JSON.stringify({
      ...DEFAULT_GLOBAL_PREFERENCES,
      faceAutoCenter: true,
      faceCenteringMode: "system",
    }))
    expect(loadGlobalPreferences()).toMatchObject({
      faceAutoCenter: true,
    })
    expect(loadGlobalPreferences()).not.toHaveProperty("faceCenteringMode")
  })

  it("saves global preferences as one value", () => {
    const preferences = { ...DEFAULT_GLOBAL_PREFERENCES, volume: 0.4, repeatMode: "file" as const }
    saveGlobalPreferences(preferences)
    expect(loadGlobalPreferences()).toEqual(preferences)
  })

  it("migrates the legacy playlist repeat mode to folder repeat", () => {
    localStorage.setItem("foursmith-vr:preferences", JSON.stringify({
      ...DEFAULT_GLOBAL_PREFERENCES,
      repeatMode: "playlist",
    }))
    expect(loadGlobalPreferences().repeatMode).toBe("folder")
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

  it("migrates the legacy projection id field", () => {
    localStorage.setItem("foursmith-vr:last-playback", JSON.stringify({
      key: "url:movie.mp4",
      position: 18.5,
      presetId: 2,
    }))
    expect(loadLastPlayback()).toEqual({
      key: "url:movie.mp4",
      position: 18.5,
      projectionId: 2,
    })
  })

  it.each([
    { key: "", position: 18.5, projectionId: 2 },
    { key: "url:movie.mp4", projectionId: 2 },
    { key: "url:movie.mp4", position: Number.NaN, projectionId: 2 },
    { key: "url:movie.mp4", position: -1, projectionId: 2 },
    { key: "url:movie.mp4", position: 18.5 },
    { key: "url:movie.mp4", position: 18.5, projectionId: 4 },
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
