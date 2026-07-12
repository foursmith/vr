import { createSignal } from "solid-js"

export type SliderControl = "quality" | "volume" | "scale"
interface SliderAnchor { x: number, bottom: number }

const CONTROL_IDLE_HIDE_DELAY = 1800
const CURSOR_IDLE_HIDE_DELAY = 1800
const INITIAL_CONTROL_HIDE_DELAY = 3600

export function createControls(options: {
  hasVideo: () => boolean
  playlistOpen: () => boolean
  resourcesReady: () => boolean
}) {
  let controlsZone!: HTMLElement
  let controlsPanel!: HTMLDivElement
  let hideControlsTimer: number | undefined
  let hideCursorTimer: number | undefined
  let hideSliderTimer: number | undefined
  let mouseMoveFrame = 0
  let pendingMousePosition = { x: 0, y: 0 }
  let controlsZoneRect: DOMRect | undefined
  let controlsZoneResizeObserver: ResizeObserver | undefined
  let pointerInControlZone = false
  let touchStart: { id: number, x: number, y: number } | undefined

  const [activeSlider, setActiveSlider] = createSignal<SliderControl>()
  const [sliderAnchor, setSliderAnchor] = createSignal<SliderAnchor>({ x: 0, bottom: 72 })
  const [controlsVisible, setControlsVisible] = createSignal(true)
  const [cursorVisible, setCursorVisible] = createSignal(true)

  const cancelHideControls = () => {
    if (hideControlsTimer === undefined) return
    window.clearTimeout(hideControlsTimer)
    hideControlsTimer = undefined
  }

  const showControls = () => {
    cancelHideControls()
    setControlsVisible(true)
  }

  const scheduleHideControls = (delay = CONTROL_IDLE_HIDE_DELAY) => {
    if (!options.hasVideo()) {
      setControlsVisible(true)
      return
    }
    cancelHideControls()
    hideControlsTimer = window.setTimeout(() => {
      setControlsVisible(false)
      setActiveSlider(undefined)
      hideControlsTimer = undefined
    }, delay)
  }

  const cancelHideCursor = () => {
    if (hideCursorTimer === undefined) return
    window.clearTimeout(hideCursorTimer)
    hideCursorTimer = undefined
  }

  const showCursor = () => {
    cancelHideCursor()
    setCursorVisible(true)
  }

  const scheduleHideCursor = (delay = CURSOR_IDLE_HIDE_DELAY) => {
    if (!options.hasVideo()) {
      setCursorVisible(true)
      return
    }
    cancelHideCursor()
    hideCursorTimer = window.setTimeout(() => {
      setCursorVisible(false)
      hideCursorTimer = undefined
    }, delay)
  }

  const updateControlsZoneRect = () => {
    controlsZoneRect = controlsZone.getBoundingClientRect()
  }

  const isInControlZone = (x: number, y: number) => {
    const rect = controlsZoneRect
    if (!rect) return false
    const playlistActivationWidth = window.matchMedia("(min-width: 640px)").matches
      ? 312
      : Math.min(252, window.innerWidth)
    const isInPlaylistZone = options.playlistOpen() && x <= playlistActivationWidth
    const isInPlaybackZone = x >= rect.left && x <= rect.right
      && y >= rect.top && y <= rect.bottom
    return isInPlaylistZone || isInPlaybackZone
  }

  const applyPlayerMouseMove = () => {
    mouseMoveFrame = 0
    if (isInControlZone(pendingMousePosition.x, pendingMousePosition.y)) {
      pointerInControlZone = true
      showControls()
      showCursor()
      return
    }
    if (pointerInControlZone) pointerInControlZone = false
    showCursor()
    scheduleHideCursor()
    scheduleHideControls()
  }

  const handlePlayerPointerMove = (event: PointerEvent) => {
    if (event.pointerType !== "mouse") return
    if (!options.resourcesReady()) return
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
    cancelHideControls()
    setActiveSlider(undefined)
    setControlsVisible(current => !current)
  }

  const startInitialIdleCountdown = () => {
    pointerInControlZone = false
    showControls()
    showCursor()
    scheduleHideControls(INITIAL_CONTROL_HIDE_DELAY)
    scheduleHideCursor(INITIAL_CONTROL_HIDE_DELAY)
  }

  const cancelHideSlider = () => {
    if (hideSliderTimer === undefined) return
    window.clearTimeout(hideSliderTimer)
    hideSliderTimer = undefined
  }

  const scheduleHideSlider = (delay = 180) => {
    cancelHideSlider()
    hideSliderTimer = window.setTimeout(() => {
      setActiveSlider(undefined)
      hideSliderTimer = undefined
    }, delay)
  }

  const showSlider = (control: SliderControl, button: HTMLElement) => {
    cancelHideSlider()
    const panelRect = controlsPanel.getBoundingClientRect()
    const buttonRect = button.getBoundingClientRect()
    setSliderAnchor({
      x: buttonRect.left + buttonRect.width / 2 - panelRect.left,
      bottom: panelRect.bottom - buttonRect.top + 10,
    })
    setActiveSlider(control)
    showControls()
  }

  const dispose = () => {
    cancelHideControls()
    cancelHideCursor()
    cancelHideSlider()
    if (mouseMoveFrame) window.cancelAnimationFrame(mouseMoveFrame)
    controlsZoneResizeObserver?.disconnect()
    window.removeEventListener("resize", updateControlsZoneRect)
  }

  const setControlsZone = (element: HTMLElement) => {
    controlsZone = element
    controlsZoneResizeObserver?.disconnect()
    controlsZoneResizeObserver = new ResizeObserver(updateControlsZoneRect)
    controlsZoneResizeObserver.observe(element)
    window.removeEventListener("resize", updateControlsZoneRect)
    window.addEventListener("resize", updateControlsZoneRect)
    updateControlsZoneRect()
  }

  return {
    activeSlider,
    cancelHideSlider,
    containsControlsPanel: (node: Node | null) => controlsPanel.contains(node),
    controlsVisible,
    cursorVisible,
    dispose,
    handlePlayerPointerMove,
    handlePlayerPointerDown,
    handlePlayerPointerUp,
    scheduleHideControls,
    scheduleHideSlider,
    setActiveSlider,
    setControlsPanel: (element: HTMLDivElement) => (controlsPanel = element),
    setControlsZone,
    showControls,
    showSlider,
    sliderAnchor,
    startInitialIdleCountdown,
  }
}
