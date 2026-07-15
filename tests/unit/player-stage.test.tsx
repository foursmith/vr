import type { PlayerController } from "../../src/features/player/controller"
import { render } from "@solidjs/web"
import { createSignal, flush } from "solid-js"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { PlayerStage } from "../../src/components/player/PlayerStage"

const createController = () => ({
  controls: {
    controlsVisible: vi.fn(() => true),
    registerUiSurface: vi.fn(),
    setControlsHold: vi.fn(),
  },
  debug: {
    setFaceHint: vi.fn(),
    setFpsMeter: vi.fn(),
    setSampleCanvas: vi.fn(),
  },
  display: {
    toggleFullscreen: vi.fn(async () => {}),
  },
  frame: {
    faceAutoCenterPaused: vi.fn(() => false),
    handlePlayerPointerDown: vi.fn(),
    handlePlayerPointerUp: vi.fn(),
    resumeFaceAutoCenter: vi.fn(),
    setVideo: vi.fn(),
    setVrMount: vi.fn(),
    setVrRoot: vi.fn(),
  },
  playback: {
    handlePlaybackEnded: vi.fn(),
    handlePlaybackRateChange: vi.fn(),
    handlePlayingChange: vi.fn(),
    handleVolumeChange: vi.fn(),
    syncTime: vi.fn(),
    togglePlay: vi.fn(),
    togglePlayAndHideControls: vi.fn(),
  },
  subtitles: {
    text: vi.fn(() => ""),
  },
}) as unknown as PlayerController

const dispatchPointer = (target: Element, type: string, init: PointerEventInit) => {
  const event = new MouseEvent(type, { bubbles: true, ...init })
  Object.defineProperties(event, {
    pointerId: { value: init.pointerId ?? 1 },
    pointerType: { value: init.pointerType ?? "mouse" },
  })
  target.dispatchEvent(event)
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    disconnect() {}
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  document.body.replaceChildren()
})

describe("player stage gestures", () => {
  it("shows a resume action while manual movement has paused portrait centering", () => {
    const controller = createController()
    const [paused, setPaused] = createSignal(false)
    const [controlsVisible, setControlsVisible] = createSignal(true)
    controller.frame.faceAutoCenterPaused = paused
    controller.controls.controlsVisible = controlsVisible
    const host = document.createElement("div")
    document.body.append(host)
    const dispose = render(() => <PlayerStage controller={controller} />, host)

    expect(host.querySelector("button[aria-label='Resume portrait centering']")).toBeNull()
    setPaused(true)
    flush()
    host.querySelector<HTMLButtonElement>("button[aria-label='Resume portrait centering']")!.click()

    expect(controller.frame.resumeFaceAutoCenter).toHaveBeenCalledOnce()
    const resumeSurface = host.querySelector<HTMLElement>("[data-face-centering-resume]")!
    setControlsVisible(false)
    flush()
    expect(resumeSurface.getAttribute("aria-hidden")).toBe("true")
    expect(resumeSurface.hasAttribute("inert")).toBe(true)
    dispose()
  })

  it("toggles playback on a single screen click", () => {
    vi.useFakeTimers()
    const controller = createController()
    const host = document.createElement("div")
    document.body.append(host)
    const dispose = render(() => <PlayerStage controller={controller} />, host)
    const stage = host.querySelector("#vr-scene")!

    dispatchPointer(stage, "pointerdown", { button: 0, clientX: 10, clientY: 10, pointerId: 1, pointerType: "mouse" })
    dispatchPointer(stage, "pointerup", { button: 0, clientX: 10, clientY: 10, pointerId: 1, pointerType: "mouse" })
    stage.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }))
    vi.advanceTimersByTime(249)
    expect(controller.playback.togglePlay).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(controller.playback.togglePlay).toHaveBeenCalledOnce()

    dispose()
  })

  it("uses a double click only for fullscreen", () => {
    vi.useFakeTimers()
    const controller = createController()
    const host = document.createElement("div")
    document.body.append(host)
    const dispose = render(() => <PlayerStage controller={controller} />, host)
    const stage = host.querySelector("#vr-scene")!

    dispatchPointer(stage, "pointerdown", { button: 0, clientX: 10, clientY: 10, pointerId: 1, pointerType: "mouse" })
    dispatchPointer(stage, "pointerup", { button: 0, clientX: 10, clientY: 10, pointerId: 1, pointerType: "mouse" })
    stage.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }))
    dispatchPointer(stage, "pointerdown", { button: 0, clientX: 10, clientY: 10, pointerId: 1, pointerType: "mouse" })
    dispatchPointer(stage, "pointerup", { button: 0, clientX: 10, clientY: 10, pointerId: 1, pointerType: "mouse" })
    stage.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 2 }))
    stage.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, detail: 2 }))
    vi.advanceTimersByTime(250)

    expect(controller.playback.togglePlay).not.toHaveBeenCalled()
    expect(controller.display.toggleFullscreen).toHaveBeenCalledOnce()

    dispose()
  })

  it("toggles playback and hides UI on right click", () => {
    vi.useFakeTimers()
    const controller = createController()
    const host = document.createElement("div")
    document.body.append(host)
    const dispose = render(() => <PlayerStage controller={controller} />, host)
    const stage = host.querySelector("#vr-scene")!

    dispatchPointer(stage, "pointerdown", { button: 0, clientX: 10, clientY: 10, pointerId: 1, pointerType: "mouse" })
    dispatchPointer(stage, "pointerup", { button: 0, clientX: 10, clientY: 10, pointerId: 1, pointerType: "mouse" })
    stage.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }))
    const contextMenu = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2 })
    stage.dispatchEvent(contextMenu)
    vi.advanceTimersByTime(250)

    expect(contextMenu.defaultPrevented).toBe(true)
    expect(controller.playback.togglePlay).not.toHaveBeenCalled()
    expect(controller.playback.togglePlayAndHideControls).toHaveBeenCalledOnce()

    dispose()
  })

  it("does not toggle playback after dragging the view", () => {
    vi.useFakeTimers()
    const controller = createController()
    const host = document.createElement("div")
    document.body.append(host)
    const dispose = render(() => <PlayerStage controller={controller} />, host)
    const stage = host.querySelector("#vr-scene")!

    dispatchPointer(stage, "pointerdown", { button: 0, clientX: 10, clientY: 10, pointerId: 1, pointerType: "mouse" })
    dispatchPointer(stage, "pointerup", { button: 0, clientX: 30, clientY: 10, pointerId: 1, pointerType: "mouse" })
    stage.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }))
    vi.advanceTimersByTime(250)

    expect(controller.playback.togglePlay).not.toHaveBeenCalled()

    dispose()
  })

  it("keeps touch taps reserved for the existing controls gesture", () => {
    vi.useFakeTimers()
    const controller = createController()
    const host = document.createElement("div")
    document.body.append(host)
    const dispose = render(() => <PlayerStage controller={controller} />, host)
    const stage = host.querySelector("#vr-scene")!

    dispatchPointer(stage, "pointerdown", { button: 0, clientX: 10, clientY: 10, pointerId: 1, pointerType: "touch" })
    dispatchPointer(stage, "pointerup", { button: 0, clientX: 10, clientY: 10, pointerId: 1, pointerType: "touch" })
    stage.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }))
    vi.advanceTimersByTime(250)

    expect(controller.playback.togglePlay).not.toHaveBeenCalled()

    dispose()
  })
})
