import { indexedDB } from "fake-indexeddb"
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import {
  flushPendingPlayback,
  loadLastPlaybackKey,
  loadPendingPlayback,
  loadVideoPlaybackState,
  persistVideoPlaybackState,
  resolveVideoPlaybackState,
  saveLastPlaybackKey,
  savePendingPlayback,
  saveVideoPlaybackState,
} from "./playback-storage"

describe("playback storage", () => {
  beforeAll(() => vi.stubGlobal("indexedDB", indexedDB))
  beforeEach(() => localStorage.clear())

  it("stores the last video key separately from playback state", () => {
    saveLastPlaybackKey("url:last.mp4")
    expect(loadLastPlaybackKey()).toBe("url:last.mp4")
    expect(loadPendingPlayback()).toBeUndefined()
  })

  it("round-trips one synchronous pending checkpoint", () => {
    const playback = { key: "url:pending.mp4", position: 18.5, projectionId: 2, updatedAt: 42 }
    savePendingPlayback(playback)
    expect(loadPendingPlayback()).toEqual(playback)
    expect(loadLastPlaybackKey()).toBe(playback.key)
  })

  it.each([
    { key: "", position: 18.5, projection: "mono_360_eqr", updatedAt: 1 },
    { key: "url:movie.mp4", projection: "mono_360_eqr", updatedAt: 1 },
    { key: "url:movie.mp4", position: -1, projection: "mono_360_eqr", updatedAt: 1 },
    { key: "url:movie.mp4", position: 1, projection: "removed", updatedAt: 1 },
  ])("rejects an invalid pending checkpoint", (playback) => {
    localStorage.setItem("foursmith-vr:playback:pending", JSON.stringify(playback))
    expect(loadPendingPlayback()).toBeUndefined()
  })

  it("round-trips one IndexedDB record", async () => {
    const state = {
      key: "url:https://example.com/movie.mp4",
      updatedAt: 42,
      position: 73.5,
      projectionId: 2,
    }
    await saveVideoPlaybackState(state)
    expect(await loadVideoPlaybackState(state.key)).toEqual(state)
  })

  it("does not let an older write overwrite newer IndexedDB state", async () => {
    const key = "url:indexeddb-newer.mp4"
    const newer = { key, updatedAt: 100, position: 80, projectionId: 2 }
    await saveVideoPlaybackState(newer)
    expect(await saveVideoPlaybackState({ key, updatedAt: 50, position: 20, projectionId: 0 })).toEqual(newer)
    expect(await loadVideoPlaybackState(key)).toEqual(newer)
  })

  it("clears a pending checkpoint after it is committed", async () => {
    const checkpoint = { key: "url:committed.mp4", position: 27, projectionId: 2, updatedAt: 42 }
    savePendingPlayback(checkpoint)
    await persistVideoPlaybackState(checkpoint)
    expect(loadPendingPlayback()).toBeUndefined()
    expect(loadLastPlaybackKey()).toBe(checkpoint.key)
  })

  it("does not clear a newer pending checkpoint after an older commit", async () => {
    const key = "url:newer-pending.mp4"
    const pending = { key, position: 80, projectionId: 2, updatedAt: 100 }
    savePendingPlayback(pending)
    await persistVideoPlaybackState({ key, position: 20, projectionId: 0, updatedAt: 50 })
    expect(loadPendingPlayback()).toEqual(pending)
  })

  it("flushes the pending checkpoint on startup", async () => {
    const checkpoint = { key: "url:startup-flush.mp4", position: 27, projectionId: 2, updatedAt: 42 }
    savePendingPlayback(checkpoint)
    await flushPendingPlayback()
    expect(await loadVideoPlaybackState(checkpoint.key)).toEqual(checkpoint)
    expect(loadPendingPlayback()).toBeUndefined()
  })

  it("resolves a conflict in favor of newer IndexedDB state", async () => {
    const key = "url:resolve-indexeddb.mp4"
    const stored = { key, position: 80, projectionId: 2, updatedAt: 100 }
    await saveVideoPlaybackState(stored)
    savePendingPlayback({ key, position: 20, projectionId: 0, updatedAt: 50 })
    expect(await resolveVideoPlaybackState(key)).toEqual(stored)
    expect(loadPendingPlayback()).toBeUndefined()
  })

  it("commits and resolves a newer pending checkpoint", async () => {
    const key = "url:resolve-pending.mp4"
    const pending = { key, position: 80, projectionId: 2, updatedAt: 100 }
    await saveVideoPlaybackState({ key, position: 20, projectionId: 0, updatedAt: 50 })
    savePendingPlayback(pending)
    expect(await resolveVideoPlaybackState(key)).toEqual(pending)
    expect(await loadVideoPlaybackState(key)).toEqual(pending)
    expect(loadPendingPlayback()).toBeUndefined()
  })
})
