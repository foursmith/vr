import { indexedDB } from "fake-indexeddb"
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import {
  loadLastPlaybackKey,
  loadPendingPlayback,
  loadVideoPlaybackState,
  savePendingPlayback,
} from "../playback-storage"
import { createPlaybackHistory } from "./playback-history"

const createHistory = () => {
  const video = { currentTime: 0 } as HTMLVideoElement
  let projectionId = 0
  const history = createPlaybackHistory({
    getProjectionId: () => projectionId,
    getVideo: () => video,
  })
  return {
    history,
    setPlayback: (position: number, projection: number) => {
      video.currentTime = position
      projectionId = projection
    },
  }
}

describe("playback history write-back buffer", () => {
  beforeAll(() => vi.stubGlobal("indexedDB", indexedDB))
  beforeEach(() => localStorage.clear())

  it("flushes the synchronous last-playback checkpoint on startup", async () => {
    const checkpoint = {
      key: "url:startup-flush.mp4",
      position: 27,
      projectionId: 2,
      updatedAt: 42,
    }
    savePendingPlayback(checkpoint)

    createHistory()

    await vi.waitFor(async () => {
      expect(await loadVideoPlaybackState(checkpoint.key)).toEqual(checkpoint)
    })
  })

  it("does not replace the buffered checkpoint with zero before history loads", async () => {
    const checkpoint = {
      key: "url:previous.mp4",
      position: 27,
      projectionId: 2,
      updatedAt: 42,
    }
    savePendingPlayback(checkpoint)
    const { history } = createHistory()

    expect(await history.activate("url:next.mp4")).toBeUndefined()
    expect(loadLastPlaybackKey()).toBe("url:next.mp4")
    expect(await loadVideoPlaybackState(checkpoint.key)).toEqual(checkpoint)
  })

  it("covers playback, commit, abrupt close recovery, restart, and video switching", async () => {
    const firstKey = "url:full-flow-first.mp4"
    const secondKey = "url:full-flow-second.mp4"

    const firstSession = createHistory()
    expect(await firstSession.history.activate(firstKey)).toBeUndefined()
    firstSession.setPlayback(12.5, 2)
    firstSession.history.persistLast(true)
    expect(loadPendingPlayback()).toMatchObject({ key: firstKey, position: 12.5, projectionId: 2 })

    await firstSession.history.persistActive()
    expect(loadPendingPlayback()).toBeUndefined()
    expect(await loadVideoPlaybackState(firstKey)).toMatchObject({
      key: firstKey,
      position: 12.5,
      projectionId: 2,
    })

    const secondSession = createHistory()
    expect(await secondSession.history.activate(firstKey)).toMatchObject({
      key: firstKey,
      position: 12.5,
      projectionId: 2,
    })
    secondSession.setPlayback(33, 6)
    secondSession.history.persistLast(true)
    expect(loadPendingPlayback()).toMatchObject({ key: firstKey, position: 33, projectionId: 6 })

    // A new controller simulates reopening after the previous page closed
    // before its asynchronous IndexedDB commit completed.
    const recoveredSession = createHistory()
    expect(await recoveredSession.history.activate(firstKey)).toMatchObject({
      key: firstKey,
      position: 33,
      projectionId: 6,
    })
    expect(loadPendingPlayback()).toBeUndefined()
    expect(await loadVideoPlaybackState(firstKey)).toMatchObject({ position: 33, projectionId: 6 })

    recoveredSession.setPlayback(44, 2)
    await recoveredSession.history.persistActive()
    recoveredSession.history.deactivate()
    expect(await recoveredSession.history.activate(secondKey)).toBeUndefined()
    recoveredSession.history.writeLast({ key: secondKey, position: 0, projectionId: 0 })
    recoveredSession.setPlayback(8, 1)
    await recoveredSession.history.persistActive()

    expect(loadLastPlaybackKey()).toBe(secondKey)
    expect(await loadVideoPlaybackState(firstKey)).toMatchObject({ position: 44, projectionId: 2 })
    expect(await loadVideoPlaybackState(secondKey)).toMatchObject({ position: 8, projectionId: 1 })
  })
})
