import { createMemo, createSignal } from "solid-js"

export type SliderControl = "adjustments"
export type ControlsHoldReason = "focus" | "pointer" | "scrubbing" | "popover" | "settings" | "loading"
interface SliderAnchor { x: number, bottom: number }

const CONTROL_IDLE_HIDE_DELAY = 2500
const TOUCH_IDLE_HIDE_DELAY = 3000
const KEYBOARD_IDLE_HIDE_DELAY = 1500
const INITIAL_CONTROL_HIDE_DELAY = 3600
const MOUSE_JITTER_THRESHOLD = 3

export function createControls(options: {
  hasVideo: () => boolean
  resourcesReady: () => boolean
}) {
  let controlsPanel!: HTMLDivElement
  let hideControlsTimer: number | undefined
  let mouseMoveFrame = 0
  let pendingMousePosition = { x: 0, y: 0 }
  let lastMousePosition: { x: number, y: number } | undefined
  let touchStart: { id: number, x: number, y: number } | undefined
  let heldReasons: ReadonlySet<ControlsHoldReason> = new Set()
  const uiSurfaces = new Set<HTMLElement>()
  const activeUiTouchPointers = new Set<number>()

  const [activeSlider, setActiveSliderState] = createSignal<SliderControl>()
  const [sliderAnchor, setSliderAnchor] = createSignal<SliderAnchor>({ x: 0, bottom: 72 })
  const [temporarilyVisible, setTemporarilyVisible] = createSignal(true)
  const [holdReasons, setHoldReasons] = createSignal(heldReasons)
  const controlsVisible = createMemo(() => temporarilyVisible() || holdReasons().size > 0 || !options.hasVideo())

  const cancelHideControls = () => {
    if (hideControlsTimer === undefined) return
    window.clearTimeout(hideControlsTimer)
    hideControlsTimer = undefined
  }

  const showControls = () => {
    cancelHideControls()
    setTemporarilyVisible(true)
  }

  const armHideControls = (delay: number) => {
    cancelHideControls()
    hideControlsTimer = window.setTimeout(() => {
      if (heldReasons.size > 0) return
      setTemporarilyVisible(false)
      setActiveSliderState(undefined)
      hideControlsTimer = undefined
    }, delay)
  }

  const setControlsHold = (reason: ControlsHoldReason, held: boolean) => {
    const current = heldReasons
    if (current.has(reason) === held) return
    const next = new Set(current)
    if (held) next.add(reason)
    else next.delete(reason)
    heldReasons = next
    setHoldReasons(next)
    if (held) {
      cancelHideControls()
      setTemporarilyVisible(true)
    } else if (next.size === 0 && options.hasVideo()) {
      armHideControls(CONTROL_IDLE_HIDE_DELAY)
    }
  }

  function scheduleHideControls(delay = CONTROL_IDLE_HIDE_DELAY) {
    if (!options.hasVideo() || heldReasons.size > 0) {
      setTemporarilyVisible(true)
      return
    }
    armHideControls(delay)
  }

  const registerActivity = (source: "mouse" | "touch" | "keyboard" | "playback") => {
    if (!options.resourcesReady()) return
    showControls()
    scheduleHideControls(source === "touch" ? TOUCH_IDLE_HIDE_DELAY : source === "keyboard" ? KEYBOARD_IDLE_HIDE_DELAY : CONTROL_IDLE_HIDE_DELAY)
  }

  const registerUiSurface = (element: HTMLElement) => {
    uiSurfaces.add(element)
  }

  const isUiTarget = (target: EventTarget | null) => {
    if (!(target instanceof Node)) return false
    for (const surface of uiSurfaces) {
      if (!surface.isConnected) {
        uiSurfaces.delete(surface)
        continue
      }
      if (surface.contains(target)) return true
    }
    return false
  }

  const handleUiPointerDown = (event: PointerEvent) => {
    if (event.pointerType !== "touch" || !isUiTarget(event.target)) return
    activeUiTouchPointers.add(event.pointerId)
    setControlsHold("pointer", true)
  }

  const handleUiPointerUp = (event: PointerEvent) => {
    if (event.pointerType !== "touch" || !activeUiTouchPointers.delete(event.pointerId)) return
    if (activeUiTouchPointers.size === 0) setControlsHold("pointer", false)
  }

  const hideControls = () => {
    cancelHideControls()
    activeUiTouchPointers.clear()
    heldReasons = new Set()
    setHoldReasons(heldReasons)
    setActiveSliderState(undefined)
    setTemporarilyVisible(false)
  }

  const resyncPointerHold = () => {
    const position = lastMousePosition
    if (!position) {
      setControlsHold("pointer", false)
      return
    }
    const hit = document.elementFromPoint(position.x, position.y)
    let pointerOverUi = false
    for (const surface of uiSurfaces) {
      if (!surface.isConnected) {
        uiSurfaces.delete(surface)
        continue
      }
      if (hit && surface.contains(hit)) pointerOverUi = true
    }
    setControlsHold("pointer", pointerOverUi)
  }

  const applyPlayerMouseMove = () => {
    mouseMoveFrame = 0
    const previous = lastMousePosition
    lastMousePosition = pendingMousePosition
    if (previous && Math.hypot(pendingMousePosition.x - previous.x, pendingMousePosition.y - previous.y) < MOUSE_JITTER_THRESHOLD) return
    registerActivity("mouse")
    resyncPointerHold()
  }

  const handlePlayerPointerMove = (event: PointerEvent) => {
    if (event.pointerType !== "mouse" || !options.resourcesReady()) return
    pendingMousePosition = { x: event.clientX, y: event.clientY }
    if (!mouseMoveFrame) mouseMoveFrame = window.requestAnimationFrame(applyPlayerMouseMove)
  }

  const handlePlayerPointerDown = (event: PointerEvent) => {
    if (event.pointerType !== "touch") return
    touchStart = { id: event.pointerId, x: event.clientX, y: event.clientY }
  }

  const handlePlayerPointerUp = (event: PointerEvent) => {
    if (event.pointerType !== "touch" || touchStart?.id !== event.pointerId) return
    const movement = Math.hypot(event.clientX - touchStart.x, event.clientY - touchStart.y)
    touchStart = undefined
    if (movement > 12) return
    if (!options.hasVideo()) {
      showControls()
      return
    }
    if (controlsVisible()) hideControls()
    else registerActivity("touch")
  }

  const startInitialIdleCountdown = () => {
    lastMousePosition = undefined
    showControls()
    scheduleHideControls(INITIAL_CONTROL_HIDE_DELAY)
  }

  const closeSlider = () => {
    setActiveSliderState(undefined)
    setControlsHold("popover", false)
  }

  const updateSliderAnchor = (button: HTMLElement) => {
    const panelRect = controlsPanel.getBoundingClientRect()
    const buttonRect = button.getBoundingClientRect()
    setSliderAnchor({
      x: buttonRect.left + buttonRect.width / 2 - panelRect.left,
      bottom: panelRect.bottom - buttonRect.top + 10,
    })
  }

  const toggleSlider = (control: SliderControl, button: HTMLElement) => {
    if (activeSlider() === control) {
      closeSlider()
      return
    }
    updateSliderAnchor(button)
    setActiveSliderState(control)
    setControlsHold("popover", true)
  }

  const dispose = () => {
    cancelHideControls()
    if (mouseMoveFrame) window.cancelAnimationFrame(mouseMoveFrame)
    activeUiTouchPointers.clear()
    uiSurfaces.clear()
  }

  return {
    activeSlider,
    closeSlider,
    controlsVisible,
    dispose,
    handlePlayerPointerMove,
    handlePlayerPointerDown,
    handlePlayerPointerUp,
    handleUiPointerDown,
    handleUiPointerUp,
    hideControls,
    registerActivity,
    registerUiSurface,
    resyncPointerHold,
    scheduleHideControls,
    setControlsHold,
    setControlsPanel: (element: HTMLDivElement) => (controlsPanel = element),
    showControls,
    toggleSlider,
    updateSliderAnchor,
    sliderAnchor,
    startInitialIdleCountdown,
  }
}
