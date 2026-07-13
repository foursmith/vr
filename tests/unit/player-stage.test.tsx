import type { PlayerController } from "../../src/features/player/controller"
import { render } from "@solidjs/web"
import { afterEach, describe, expect, it, vi } from "vitest"
import { PlayerStage } from "../../src/components/player/PlayerStage"

const createController = () => ({
  debug: {
    setFaceHint: vi.fn(),
    setFpsMeter: vi.fn(),
    setSampleCanvas: vi.fn(),
  },
  display: {
    toggleFullscreen: vi.fn(async () => {}),
  },
  frame: {
    handlePlayerPointerDown: vi.fn(),
    handlePlayerPointerUp: vi.fn(),
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

afterEach(() => {
  vi.useRealTimers()
  document.body.replaceChildren()
})

describe("player stage gestures", () => {
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
