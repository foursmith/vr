import { createRoot, flush } from "solid-js"
import { describe, expect, it, vi } from "vitest"
import { createDisplay } from "../../src/features/player/display"

describe("player display state", () => {
  it("guards unavailable resources and clamps zoom and quality", () => {
    let ready = false
    const viewRef = { current: { yaw: 12, pitch: -4, zoom: 1, forward: 8, pausedUntil: 0 } }
    let dispose!: () => void
    const display = createRoot((rootDispose) => {
      dispose = rootDispose
      return createDisplay({ getPlayer: () => document.body, resourcesReady: () => ready, viewRef })
    })
    expect(display.qualityId()).toBe(2)
    expect(display.renderFrameRateId()).toBe(3)
    expect(display.faceAutoCenter()).toBe(true)
    display.controller.setZoom(3)
    expect(display.controller.zoom()).toBe(1)
    ready = true
    display.controller.setZoom(3)
    flush()
    expect(display.controller.zoom()).toBe(2.4)
    expect(viewRef.current.zoom).toBe(2.4)
    display.changeQualityBy(99)
    flush()
    expect(display.qualityId()).toBe(3)
    display.controller.setRenderFrameRateId(99)
    flush()
    expect(display.renderFrameRateId()).toBe(3)
    display.controller.resetView()
    flush()
    expect(viewRef.current).toMatchObject({ yaw: 0, pitch: 0, zoom: 1, forward: 0 })
    dispose()
  })

  it("enters and exits fullscreen and synchronizes state", async () => {
    const player = document.createElement("div")
    player.requestFullscreen = vi.fn().mockResolvedValue(undefined)
    const exitFullscreen = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(document, "exitFullscreen", { configurable: true, value: exitFullscreen })
    const display = createDisplay({ getPlayer: () => player, resourcesReady: () => true, viewRef: { current: { yaw: 0, pitch: 0, zoom: 1, forward: 0, pausedUntil: 0 } } })
    await display.controller.toggleFullscreen()
    expect(player.requestFullscreen).toHaveBeenCalled()
    Object.defineProperty(document, "fullscreenElement", { configurable: true, value: player })
    display.syncFullscreen()
    flush()
    expect(display.controller.fullscreen()).toBe(true)
    await display.controller.toggleFullscreen()
    expect(exitFullscreen).toHaveBeenCalled()
  })

  it("applies initial global display preferences and updates transient display state", () => {
    const display = createDisplay({
      getPlayer: () => document.body,
      resourcesReady: () => true,
      viewRef: { current: { yaw: 0, pitch: 0, zoom: 1, forward: 0, pausedUntil: 0 } },
      initialState: { qualityId: 1, renderFrameRateId: 1, splitScreen: false, faceAutoCenter: false },
    })
    expect(display.controller.state).toMatchObject({ qualityId: 1, renderFrameRateId: 1, splitScreen: false, faceAutoCenter: false })
    display.controller.setProjectionId(2)
    display.controller.setZoom(1.5)
    flush()
    expect(display.controller.state.projectionId).toBe(2)
    expect(display.controller.zoom()).toBe(1.5)
  })

  it("reports effective manual zoom and reset-view changes", () => {
    const onManualViewChange = vi.fn()
    const display = createDisplay({
      getPlayer: () => document.body,
      resourcesReady: () => true,
      viewRef: { current: { yaw: 8, pitch: -3, zoom: 1, forward: 0, pausedUntil: 0 } },
      onManualViewChange,
    })

    display.controller.setZoom(1)
    expect(onManualViewChange).not.toHaveBeenCalled()
    display.controller.setZoom(1.4)
    display.controller.resetView()
    expect(onManualViewChange).toHaveBeenCalledTimes(2)
  })
})
