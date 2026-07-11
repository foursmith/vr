import { createSignal } from 'solid-js'

export type SliderControl = 'quality' | 'volume' | 'scale'
type SliderAnchor = { x: number; bottom: number }

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
  let pointerInControlZone = false

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

  const isInControlZone = (event: MouseEvent) => {
    const rect = controlsZone.getBoundingClientRect()
    const playlistActivationWidth = window.matchMedia('(min-width: 640px)').matches
      ? 312
      : Math.min(252, window.innerWidth)
    const isInPlaylistZone = options.playlistOpen() && event.clientX <= playlistActivationWidth
    const isInPlaybackZone = event.clientX >= rect.left && event.clientX <= rect.right
      && event.clientY >= rect.top && event.clientY <= rect.bottom
    return isInPlaylistZone || isInPlaybackZone
  }

  const handlePlayerMouseMove = (event: MouseEvent) => {
    if (!options.resourcesReady()) return
    if (isInControlZone(event)) {
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
  }

  return {
    activeSlider,
    cancelHideSlider,
    containsControlsPanel: (node: Node | null) => controlsPanel.contains(node),
    controlsVisible,
    cursorVisible,
    dispose,
    handlePlayerMouseMove,
    scheduleHideControls,
    scheduleHideSlider,
    setActiveSlider,
    setControlsPanel: (element: HTMLDivElement) => (controlsPanel = element),
    setControlsZone: (element: HTMLElement) => (controlsZone = element),
    showControls,
    showSlider,
    sliderAnchor,
    startInitialIdleCountdown,
  }
}
