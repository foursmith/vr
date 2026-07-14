import { createRoot, flush } from "solid-js"
import { afterEach, describe, expect, it, vi } from "vitest"
import { createControls } from "../../src/features/player/controls"

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe("player controls", () => {
  it("keeps controls visible without media and hides them after media inactivity", () => {
    vi.useFakeTimers()
    let hasVideo = false
    let dispose!: () => void
    const controls = createRoot((rootDispose) => {
      dispose = rootDispose
      return createControls({ hasVideo: () => hasVideo, resourcesReady: () => true })
    })
    controls.scheduleHideControls(10)
    vi.advanceTimersByTime(10)
    flush()
    expect(controls.controlsVisible()).toBe(true)

    hasVideo = true
    controls.scheduleHideControls(10)
    vi.advanceTimersByTime(10)
    flush()
    expect(controls.controlsVisible()).toBe(false)
    controls.showControls()
    flush()
    expect(controls.controlsVisible()).toBe(true)
    controls.dispose()
    dispose()
  })

  it("positions and toggles the adjustment panel on click", () => {
    vi.useFakeTimers()
    let dispose!: () => void
    const controls = createRoot((rootDispose) => {
      dispose = rootDispose
      return createControls({ hasVideo: () => true, resourcesReady: () => true })
    })
    const panel = document.createElement("div")
    const button = document.createElement("button")
    vi.spyOn(panel, "getBoundingClientRect").mockReturnValue({ left: 100, right: 500, top: 400, bottom: 700, width: 400, height: 300, x: 100, y: 400, toJSON: () => ({}) })
    vi.spyOn(button, "getBoundingClientRect").mockReturnValue({ left: 180, right: 220, top: 620, bottom: 660, width: 40, height: 40, x: 180, y: 620, toJSON: () => ({}) })
    controls.setControlsPanel(panel)
    controls.toggleSlider("adjustments", button)
    flush()
    expect(controls.activeSlider()).toBe("adjustments")
    expect(controls.controlsVisible()).toBe(true)
    expect(controls.sliderAnchor()).toEqual({ x: 100, bottom: 90 })

    controls.toggleSlider("adjustments", button)
    flush()
    expect(controls.activeSlider()).toBeUndefined()
    controls.dispose()
    dispose()
  })

  it("pins controls while an interaction hold is active", () => {
    vi.useFakeTimers()
    let dispose!: () => void
    const controls = createRoot((rootDispose) => {
      dispose = rootDispose
      return createControls({ hasVideo: () => true, resourcesReady: () => true })
    })

    controls.setControlsHold("focus", true)
    controls.scheduleHideControls(10)
    vi.advanceTimersByTime(10)
    flush()
    expect(controls.controlsVisible()).toBe(true)

    controls.setControlsHold("focus", false)
    controls.scheduleHideControls(10)
    vi.advanceTimersByTime(10)
    flush()
    expect(controls.controlsVisible()).toBe(false)
    controls.dispose()
    dispose()
  })

  it("clears interaction holds when controls are explicitly hidden", () => {
    let dispose!: () => void
    const controls = createRoot((rootDispose) => {
      dispose = rootDispose
      return createControls({ hasVideo: () => true, resourcesReady: () => true })
    })

    controls.setControlsHold("focus", true)
    controls.hideControls()
    flush()
    expect(controls.controlsVisible()).toBe(false)

    controls.registerActivity("mouse")
    flush()
    expect(controls.controlsVisible()).toBe(true)

    controls.dispose()
    dispose()
  })

  it("toggles held controls from a touch tap on the player stage", () => {
    let dispose!: () => void
    const controls = createRoot((rootDispose) => {
      dispose = rootDispose
      return createControls({ hasVideo: () => true, resourcesReady: () => true })
    })

    controls.registerActivity("playback")
    controls.setControlsHold("focus", true)
    controls.handlePlayerPointerDown({ pointerType: "touch", pointerId: 1, clientX: 10, clientY: 10 } as PointerEvent)
    controls.handlePlayerPointerUp({ pointerType: "touch", pointerId: 1, clientX: 10, clientY: 10 } as PointerEvent)
    flush()
    expect(controls.controlsVisible()).toBe(false)

    controls.handlePlayerPointerDown({ pointerType: "touch", pointerId: 2, clientX: 10, clientY: 10 } as PointerEvent)
    controls.handlePlayerPointerUp({ pointerType: "touch", pointerId: 2, clientX: 10, clientY: 10 } as PointerEvent)
    flush()
    expect(controls.controlsVisible()).toBe(true)

    controls.dispose()
    dispose()
  })

  it("shows controls temporarily for keyboard activity", () => {
    vi.useFakeTimers()
    let dispose!: () => void
    const controls = createRoot((rootDispose) => {
      dispose = rootDispose
      return createControls({ hasVideo: () => true, resourcesReady: () => true })
    })
    controls.scheduleHideControls(0)
    vi.advanceTimersByTime(0)
    flush()
    expect(controls.controlsVisible()).toBe(false)

    controls.registerActivity("keyboard")
    flush()
    expect(controls.controlsVisible()).toBe(true)
    vi.advanceTimersByTime(1500)
    flush()
    expect(controls.controlsVisible()).toBe(false)
    controls.dispose()
    dispose()
  })

  it("pins controls only while the pointer hits a registered UI surface", () => {
    vi.useFakeTimers()
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => window.setTimeout(callback, 0, 0))
    const originalElementFromPoint = Object.getOwnPropertyDescriptor(document, "elementFromPoint")
    const surface = document.createElement("div")
    const child = document.createElement("button")
    surface.append(child)
    document.body.append(surface)
    let hit: Element | null = child
    Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => hit })
    let dispose!: () => void
    const controls = createRoot((rootDispose) => {
      dispose = rootDispose
      return createControls({ hasVideo: () => true, resourcesReady: () => true })
    })
    controls.registerUiSurface(surface)

    controls.handlePlayerPointerMove({ pointerType: "mouse", clientX: 10, clientY: 10 } as PointerEvent)
    vi.advanceTimersByTime(0)
    controls.scheduleHideControls(10)
    vi.advanceTimersByTime(10)
    flush()
    expect(controls.controlsVisible()).toBe(true)

    hit = document.body
    controls.handlePlayerPointerMove({ pointerType: "mouse", clientX: 20, clientY: 20 } as PointerEvent)
    vi.advanceTimersByTime(0)
    vi.advanceTimersByTime(2500)
    flush()
    expect(controls.controlsVisible()).toBe(false)

    controls.dispose()
    dispose()
    surface.remove()
    if (originalElementFromPoint) Object.defineProperty(document, "elementFromPoint", originalElementFromPoint)
    else delete (document as { elementFromPoint?: typeof document.elementFromPoint }).elementFromPoint
  })

  it("pins controls while a touch pointer is held on a registered UI surface", () => {
    vi.useFakeTimers()
    const surface = document.createElement("div")
    const button = document.createElement("button")
    surface.append(button)
    document.body.append(surface)
    let dispose!: () => void
    const controls = createRoot((rootDispose) => {
      dispose = rootDispose
      return createControls({ hasVideo: () => true, resourcesReady: () => true })
    })
    controls.registerUiSurface(surface)

    controls.handleUiPointerDown({ pointerType: "touch", pointerId: 1, target: button } as unknown as PointerEvent)
    controls.scheduleHideControls(10)
    vi.advanceTimersByTime(10)
    flush()
    expect(controls.controlsVisible()).toBe(true)

    controls.handleUiPointerUp({ pointerType: "touch", pointerId: 1 } as PointerEvent)
    vi.advanceTimersByTime(2500)
    flush()
    expect(controls.controlsVisible()).toBe(false)

    controls.dispose()
    dispose()
    surface.remove()
  })
})
