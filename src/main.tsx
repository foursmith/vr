import 'virtual:uno.css'
import './index.css'
import './pwa'
import { For, Show, createEffect, createMemo, createSignal, onSettled } from 'solid-js'
import { render } from '@solidjs/web'
import {
  DEFAULT_ZOOM,
  PRESETS,
  QUALITY_OPTIONS,
  createVrScene,
  preloadFaceAutoCenterResources,
  type CameraView,
  type VrSceneController,
} from './vr-scene'
import { releaseFaceAutoCenterResources } from './face-tracker-client'
import { LiquidGlass } from './liquid-glass'

const FACE_DEBUG_WASM_URL = '/mediapipe/tasks-vision/wasm'
const FACE_DEBUG_MODEL_URL = '/models/face_detector/blaze_face_full_range.tflite'

type DebugFace = { x: number; y: number; width: number; height: number; score: number }
type NavigatorWithUserAgentData = Navigator & {
  userAgentData?: {
    brands?: Array<{ brand: string; version: string }>
  }
}

let debugDetectorPromise: Promise<import('@mediapipe/tasks-vision').FaceDetector> | undefined

const getDebugDetector = async () => {
  if (!debugDetectorPromise) {
    debugDetectorPromise = import('@mediapipe/tasks-vision').then(async ({ FaceDetector, FilesetResolver }) => {
      const vision = await FilesetResolver.forVisionTasks(FACE_DEBUG_WASM_URL)
      return FaceDetector.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: FACE_DEBUG_MODEL_URL,
          delegate: 'CPU',
        },
        runningMode: 'IMAGE',
        minDetectionConfidence: 0.25,
        minSuppressionThreshold: 0.3,
      })
    })
  }
  return debugDetectorPromise
}

const formatTime = (seconds: number) => {
  if (!Number.isFinite(seconds)) return '00:00'
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = Math.floor(seconds % 60)
  const body = [minutes, secs].map((part) => String(part).padStart(2, '0')).join(':')
  return hours > 0 ? `${hours}:${body}` : body
}

const isChromiumBrowser = () => {
  const nav = navigator as NavigatorWithUserAgentData
  const brands = nav.userAgentData?.brands?.map(({ brand }) => brand.toLowerCase()) ?? []

  if (brands.some((brand) => brand.includes('chromium') || brand.includes('google chrome'))) {
    return true
  }

  const userAgent = navigator.userAgent
  const isFirefox = /Firefox|FxiOS/i.test(userAgent)
  const isSafari = /Safari/i.test(userAgent) && !/Chrome|Chromium|CriOS|Edg|OPR|Opera/i.test(userAgent)

  return /Chrome|Chromium|CriOS|Edg|OPR|Opera/i.test(userAgent) && !isFirefox && !isSafari
}

const ICONS = {
  bug: 'i-ph-bug',
  'corners-in': 'i-ph-corners-in',
  'corners-out': 'i-ph-corners-out',
  'cube-focus': 'i-ph-cube-focus',
  'fast-forward': 'i-ph-fast-forward',
  'file-video': 'i-ph-file-video',
  gauge: 'i-ph-gauge',
  pause: 'i-ph-pause',
  play: 'i-ph-play',
  rewind: 'i-ph-rewind',
  scale: 'i-ph-magnifying-glass-plus',
  'rotate-ccw': 'i-ph-arrow-counter-clockwise',
  'scan-face': 'i-ph-scan-smiley',
  'screen-share': 'i-ph-screencast',
  upload: 'i-ph-upload',
  video: 'i-ph-video',
  'volume-1': 'i-ph-speaker-simple-low',
  'volume-2': 'i-ph-speaker-simple-high',
  'volume-x': 'i-ph-speaker-simple-x',
  x: 'i-ph-x',
} as const

type IconName = keyof typeof ICONS
type SliderControl = 'quality' | 'volume' | 'scale'
type SliderAnchor = { x: number; bottom: number }

const CONTROL_IDLE_HIDE_DELAY = 1800
const CURSOR_IDLE_HIDE_DELAY = 1800
const INITIAL_CONTROL_HIDE_DELAY = 3600

const iconButtonClass =
  'h-9 w-9 shrink-0 rounded-full text-white/92 transition hover:text-white active:scale-95'
const activeButtonClass =
  'text-white bg-white/10'
const glassPillClass =
  'text-white transition hover:text-white focus-within:text-white'
const selectClass =
  'h-full min-w-0 flex-1 cursor-pointer appearance-none border-0 bg-transparent p-0 text-xs font-medium text-white outline-none'

function Icon(props: { name: IconName; class?: string }) {
  return <span aria-hidden="true" class={[ICONS[props.name], props.class ?? 'h-4.5 w-4.5']}></span>
}

function IconButton(props: {
  label: string
  icon: IconName
  iconClass?: string
  class?: string
  pressed?: boolean
  onClick?: () => void
}) {
  return (
    <LiquidGlass
      class={[iconButtonClass, props.pressed && activeButtonClass, props.class]}
      cornerRadius={999}
      displacementScale={34}
      blurAmount={0.055}
      saturation={150}
      aberrationIntensity={2.2}
      elasticity={0.18}
      active={props.pressed}
      castShadow={false}
    >
      <button
        type="button"
        aria-label={props.label}
        aria-pressed={props.pressed === undefined ? undefined : props.pressed ? 'true' : 'false'}
        class="relative grid h-full w-full cursor-pointer place-items-center rounded-full border-0 bg-transparent p-0 text-inherit transition focus-visible:bg-white/12 focus-visible:outline-none"
        onClick={props.onClick}
      >
        <Icon name={props.icon} class={props.iconClass} />
        <Show when={props.pressed}>
          <span class="pointer-events-none absolute bottom-1.25 h-1 w-1 rounded-full bg-white/82 shadow-[0_0_4px_rgba(255,255,255,0.36)]"></span>
        </Show>
      </button>
    </LiquidGlass>
  )
}

function UnsupportedBrowser() {
  return (
    <main class="grid min-h-dvh place-items-center bg-black px-5 text-white">
      <section class="grid max-w-lg gap-4 text-center">
        <p class="text-xs font-semibold uppercase tracking-[0.24em] text-white/48">Unsupported browser</p>
        <h1 class="text-2xl font-semibold sm:text-3xl">Switch to a Chromium browser</h1>
        <p class="text-base leading-7 text-white/72">For the best experience, use Chrome or another Chromium-based browser.</p>
      </section>
    </main>
  )
}

function App() {
  let player!: HTMLElement
  let fileInput!: HTMLInputElement
  let debugImageInput!: HTMLInputElement
  let video!: HTMLVideoElement
  let controlsZone!: HTMLElement
  let controlsPanel!: HTMLDivElement
  let vrRoot!: HTMLElement
  let vrMount!: HTMLDivElement
  let sampleCanvas!: HTMLCanvasElement
  let faceHint!: HTMLDivElement
  let fpsMeter!: HTMLDivElement
  let debugImage!: HTMLImageElement | undefined

  const viewRef = { current: { yaw: 0, pitch: 0, zoom: DEFAULT_ZOOM, pausedUntil: 0 } satisfies CameraView }
  let scene: VrSceneController | undefined
  let fileUrl: string | undefined
  let debugImageUrlRef: string | undefined
  let hideControlsTimer: number | undefined
  let hideCursorTimer: number | undefined
  let hideSliderTimer: number | undefined
  let pointerInControlZone = false
  let lastAudibleVolume = 1

  const [fileName, setFileName] = createSignal<string>()
  const [hasVideo, setHasVideo] = createSignal(false)
  const [playing, setPlaying] = createSignal(false)
  const [currentTime, setCurrentTime] = createSignal(0)
  const [duration, setDuration] = createSignal(0)
  const [volume, setVolume] = createSignal(1)
  const [presetId, setPresetId] = createSignal(0)
  const [qualityId, setQualityId] = createSignal(2)
  const [zoom, setZoomSignal] = createSignal(DEFAULT_ZOOM)
  const [activeSlider, setActiveSlider] = createSignal<SliderControl>()
  const [sliderAnchor, setSliderAnchor] = createSignal<SliderAnchor>({ x: 0, bottom: 72 })
  const [videoOnly, setVideoOnly] = createSignal(false)
  const [faceAutoCenter, setFaceAutoCenter] = createSignal(true)
  const [showDetectionPreview, setShowDetectionPreview] = createSignal(false)
  const [controlsVisible, setControlsVisible] = createSignal(true)
  const [cursorVisible, setCursorVisible] = createSignal(true)
  const [fullscreen, setFullscreen] = createSignal(false)
  const [debugPanelOpen, setDebugPanelOpen] = createSignal(false)
  const [debugImageUrl, setDebugImageUrl] = createSignal<string | undefined>()
  const [debugFaces, setDebugFaces] = createSignal<DebugFace[]>([])
  const [debugStatus, setDebugStatus] = createSignal('Upload image')
  const [debugImageNeedsDetection, setDebugImageNeedsDetection] = createSignal(false)
  const [resourcesReady, setResourcesReady] = createSignal(false)
  const [loadingProgress, setLoadingProgress] = createSignal(0)
  const [loadingLabel, setLoadingLabel] = createSignal('Preparing to start')
  const [loadingError, setLoadingError] = createSignal<string>()
  let loadingPromise: Promise<void> | undefined
  let appDisposed = false

  const progress = createMemo(() => {
    const total = duration()
    return total ? Math.min(100, Math.max(0, (currentTime() / total) * 100)) : 0
  })

  const loadingPercent = createMemo(() => Math.round(Math.min(100, Math.max(0, loadingProgress()))))

  const sceneOptions = () => ({
    preset: PRESETS[presetId()].component,
    quality: QUALITY_OPTIONS[qualityId()].component,
    hidden: videoOnly(),
    faceAutoCenter: faceAutoCenter(),
    showDetectionPreview: showDetectionPreview(),
  })

  const updateVideoVisibility = (videoOnlyMode: boolean) => {
    video.classList.remove('hidden')
    video.classList.add('block')
    video.classList.toggle('opacity-100', videoOnlyMode)
    video.classList.toggle('opacity-[0.01]', !videoOnlyMode)
    video.classList.toggle('pointer-events-none', !videoOnlyMode)
    video.dataset.displayMode = videoOnlyMode ? 'video-only' : 'vr-translation-layer'
  }

  const cancelHideControls = () => {
    if (hideControlsTimer) {
      window.clearTimeout(hideControlsTimer)
      hideControlsTimer = undefined
    }
  }

  const showControls = () => {
    cancelHideControls()
    setControlsVisible(true)
  }

  const scheduleHideControls = (delay = CONTROL_IDLE_HIDE_DELAY) => {
    if (!hasVideo()) {
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
    if (hideCursorTimer) {
      window.clearTimeout(hideCursorTimer)
      hideCursorTimer = undefined
    }
  }

  const scheduleHideCursor = (delay = CURSOR_IDLE_HIDE_DELAY) => {
    if (!hasVideo()) {
      setCursorVisible(true)
      return
    }
    cancelHideCursor()
    hideCursorTimer = window.setTimeout(() => {
      setCursorVisible(false)
      hideCursorTimer = undefined
    }, delay)
  }

  const showCursor = () => {
    cancelHideCursor()
    setCursorVisible(true)
  }

  const enterControlZone = () => {
    if (!resourcesReady()) return
    pointerInControlZone = true
    showControls()
    showCursor()
  }

  const startInitialIdleCountdown = () => {
    pointerInControlZone = false
    showControls()
    showCursor()
    scheduleHideControls(INITIAL_CONTROL_HIDE_DELAY)
    scheduleHideCursor(INITIAL_CONTROL_HIDE_DELAY)
  }

  const isInControlZone = (event: MouseEvent) => {
    const rect = controlsZone.getBoundingClientRect()
    return event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom
  }

  const handlePlayerMouseMove = (event: MouseEvent) => {
    if (!resourcesReady()) return

    if (isInControlZone(event)) {
      enterControlZone()
      return
    }

    if (pointerInControlZone) pointerInControlZone = false
    showCursor()
    scheduleHideCursor()
    scheduleHideControls()
  }

  const cancelHideSlider = () => {
    if (hideSliderTimer) {
      window.clearTimeout(hideSliderTimer)
      hideSliderTimer = undefined
    }
  }

  const scheduleHideSlider = (delay = 180) => {
    cancelHideSlider()
    hideSliderTimer = window.setTimeout(() => {
      setActiveSlider(undefined)
      hideSliderTimer = undefined
    }, delay)
  }

  const syncTime = () => {
    setCurrentTime(video.currentTime || 0)
    setDuration(video.duration || 0)
  }

  const togglePlay = () => {
    if (!resourcesReady()) return

    if (!video.currentSrc) {
      openVideoFile()
      return
    }

    if (video.paused) {
      void video.play()
    } else {
      video.pause()
    }
  }

  const seekBy = (amount: number) => {
    if (!resourcesReady()) return
    if (!Number.isFinite(video.duration)) return
    video.currentTime = Math.min(video.duration, Math.max(0, video.currentTime + amount))
  }

  const setVolumeLevel = (next: number) => {
    if (!resourcesReady()) return
    const clamped = Math.min(1, Math.max(0, next))
    video.volume = clamped
    video.muted = clamped === 0
    if (clamped > 0) lastAudibleVolume = clamped
    setVolume(clamped)
  }

  const toggleMute = () => {
    if (!resourcesReady()) return
    if (volume() === 0 || video.muted) {
      setVolumeLevel(lastAudibleVolume || 0.7)
    } else {
      video.muted = true
    }
  }

  const setZoom = (next: number) => {
    if (!resourcesReady()) return
    const clamped = Math.min(2.4, Math.max(0.8, next))
    viewRef.current.zoom = clamped
    viewRef.current.pausedUntil = performance.now() + 900
    setZoomSignal(clamped)
  }

  const syncSliderAnchor = (button: HTMLElement) => {
    const panelRect = controlsPanel.getBoundingClientRect()
    const buttonRect = button.getBoundingClientRect()
    setSliderAnchor({
      x: buttonRect.left + buttonRect.width / 2 - panelRect.left,
      bottom: panelRect.bottom - buttonRect.top + 10,
    })
  }

  const showSlider = (control: SliderControl, button: HTMLElement) => {
    cancelHideSlider()
    syncSliderAnchor(button)
    setActiveSlider(control)
    showControls()
  }

  const changeQualityBy = (amount: number) => {
    if (!resourcesReady()) return
    setQualityId((current) => Math.min(QUALITY_OPTIONS.length - 1, Math.max(0, current + amount)))
  }

  const resetView = () => {
    if (!resourcesReady()) return
    viewRef.current.yaw = 0
    viewRef.current.pitch = 0
    viewRef.current.zoom = DEFAULT_ZOOM
    viewRef.current.pausedUntil = performance.now() + 900
    setZoomSignal(DEFAULT_ZOOM)
  }

  const toggleFullscreen = async () => {
    if (!resourcesReady()) return
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen()
      } else {
        await player.requestFullscreen()
      }
    } catch (error) {
      console.warn('fullscreen toggle failed', error)
    }
  }

  const openVideoFile = () => {
    fileInput.click()
  }
  const openDebugImageFile = () => {
    if (!resourcesReady()) return
    debugImageInput.click()
  }

  const loadVideoFile = (file: File) => {
    if (!file.type.startsWith('video/')) return
    if (!file) return
    if (fileUrl) URL.revokeObjectURL(fileUrl)
    fileUrl = URL.createObjectURL(file)
    setHasVideo(true)
    setFileName(file.name)
    video.src = fileUrl
    if (resourcesReady()) {
      void video.play()
      startInitialIdleCountdown()
    }
  }

  const handleFile = () => {
    const file = fileInput.files?.[0]
    if (!file) return
    loadVideoFile(file)
  }

  const handleVideoDrop = (event: DragEvent) => {
    event.preventDefault()
    const file = Array.from(event.dataTransfer?.files ?? []).find((item) => item.type.startsWith('video/'))
    if (!file) return
    loadVideoFile(file)
  }

  const handleDebugImage = () => {
    if (!resourcesReady()) return
    const file = debugImageInput.files?.[0]
    if (!file) return
    if (debugImageUrlRef) URL.revokeObjectURL(debugImageUrlRef)
    debugImageUrlRef = URL.createObjectURL(file)
    setDebugImageUrl(debugImageUrlRef)
    setDebugImageNeedsDetection(true)
    setDebugFaces([])
    setDebugStatus('Loading image')
    setDebugPanelOpen(true)
  }

  const detectDebugImage = async () => {
    if (!resourcesReady()) return
    const image = debugImage
    if (!image || !debugImageNeedsDetection() || !image.naturalWidth || !image.naturalHeight) return

    setDebugImageNeedsDetection(false)
    setDebugStatus('Running detector')
    setDebugFaces([])

    try {
      const detector = await getDebugDetector()
      const result = detector.detect(image)
      const faces = result.detections
        .filter((detection) => detection.boundingBox)
        .map((detection) => {
          const box = detection.boundingBox!
          return {
            x: box.originX / image.naturalWidth,
            y: box.originY / image.naturalHeight,
            width: box.width / image.naturalWidth,
            height: box.height / image.naturalHeight,
            score: detection.categories[0]?.score ?? 0,
          }
        })
        .sort((a, b) => b.width * b.height - a.width * a.height)
      setDebugFaces(faces)
      setDebugStatus(faces.length ? `${faces.length} face${faces.length === 1 ? '' : 's'}` : 'No face detected')
    } catch (error) {
      console.warn('debug face detector failed', error)
      setDebugStatus('Detector failed')
    }
  }

  const handleKeydown = (event: KeyboardEvent) => {
    if (!resourcesReady()) {
      event.preventDefault()
      return
    }

    const target = event.target
    const isTyping =
      target instanceof HTMLInputElement ||
      target instanceof HTMLSelectElement ||
      target instanceof HTMLTextAreaElement ||
      (target instanceof HTMLElement && target.isContentEditable)
    if (isTyping) return

    const seekAmount = event.shiftKey ? 60 : 10

    switch (event.key) {
      case ' ':
      case 'k':
      case 'K':
        event.preventDefault()
        togglePlay()
        break
      case 'ArrowLeft':
      case 'j':
      case 'J':
        event.preventDefault()
        seekBy(-seekAmount)
        break
      case 'ArrowRight':
      case 'l':
      case 'L':
        event.preventDefault()
        seekBy(seekAmount)
        break
      case 'ArrowUp':
        event.preventDefault()
        setVolumeLevel(volume() + 0.05)
        break
      case 'ArrowDown':
        event.preventDefault()
        setVolumeLevel(volume() - 0.05)
        break
      case 'm':
      case 'M':
        toggleMute()
        break
      case 'f':
      case 'F':
        void toggleFullscreen()
        break
      case 'v':
      case 'V':
        setVideoOnly((current) => !current)
        break
      case 'r':
      case 'R':
        resetView()
        break
      case '[':
      case '-':
        setZoom(zoom() - 0.1)
        break
      case ']':
      case '=':
        setZoom(zoom() + 0.1)
        break
      case ',':
        changeQualityBy(-1)
        break
      case '.':
        changeQualityBy(1)
        break
      default: {
        const presetNumber = Number(event.key)
        if (Number.isInteger(presetNumber) && presetNumber >= 1 && presetNumber <= PRESETS.length) {
          setPresetId(presetNumber - 1)
        }
      }
    }
  }

  const syncFullscreen = () => {
    setFullscreen(document.fullscreenElement === player)
  }

  const startInitialLoad = () => {
    if (loadingPromise) return

    loadingPromise = (async () => {
      setResourcesReady(false)
      setLoadingError(undefined)
      setLoadingLabel('Preparing player')
      setLoadingProgress(4)

      try {
        await preloadFaceAutoCenterResources(({ loaded, total, label }) => {
          if (appDisposed) return
          setLoadingLabel(label)
          setLoadingProgress(8 + (loaded / total) * 82)
        })
        if (appDisposed) return

        setLoadingLabel('Starting renderer')
        setLoadingProgress(96)
        scene = createVrScene({
          root: vrRoot,
          mount: vrMount,
          sampleCanvas,
          hintElement: faceHint,
          fpsElement: fpsMeter,
          video,
          viewRef,
          onZoomChange: (nextZoom) => {
            viewRef.current.zoom = nextZoom
            setZoomSignal(nextZoom)
          },
          ...sceneOptions(),
        })
        updateVideoVisibility(sceneOptions().hidden)
        setLoadingLabel('Ready')
        setLoadingProgress(100)
        setResourcesReady(true)
        if (hasVideo()) startInitialIdleCountdown()
      } catch (error) {
        if (appDisposed) return
        console.warn('initial resource loading failed', error)
        setLoadingError('Resource loading failed')
        setLoadingLabel('Unable to load resources')
      }
    })().finally(() => {
      loadingPromise = undefined
    })
  }

  onSettled(() => {
    const bootPlayer = window.requestAnimationFrame(() => {
      startInitialLoad()
    })

    window.addEventListener('keydown', handleKeydown)
    document.addEventListener('fullscreenchange', syncFullscreen)

    return () => {
      appDisposed = true
      window.cancelAnimationFrame(bootPlayer)
      window.removeEventListener('keydown', handleKeydown)
      document.removeEventListener('fullscreenchange', syncFullscreen)
      cancelHideControls()
      cancelHideCursor()
      cancelHideSlider()
      scene?.destroy()
      releaseFaceAutoCenterResources()
      if (fileUrl) URL.revokeObjectURL(fileUrl)
      if (debugImageUrlRef) URL.revokeObjectURL(debugImageUrlRef)
    }
  })

  createEffect(
    () => sceneOptions(),
    (options) => {
      scene?.update(options)
      updateVideoVisibility(options.hidden)
    },
  )

  return (
    <main
      ref={player}
      id="player"
      class={`relative h-dvh overflow-hidden bg-black text-white ${cursorVisible() ? '' : 'cursor-none'}`}
      onMouseMove={handlePlayerMouseMove}
      onDragOver={(event) => event.preventDefault()}
      onDrop={handleVideoDrop}
    >
      <input ref={fileInput} type="file" accept="video/*" class="hidden" onChange={handleFile} />
      <input ref={debugImageInput} type="file" accept="image/*" class="hidden" onChange={handleDebugImage} />

      <section ref={vrRoot} id="vr-scene" class="absolute inset-0 h-dvh w-full opacity-100" aria-hidden={videoOnly() ? 'true' : 'false'}>
        <div ref={vrMount} id="vr-mount" class="h-full w-full"></div>
        <div class="pointer-events-none absolute inset-0 z-10">
          <div
            ref={fpsMeter}
            id="fps-meter"
            class="absolute left-3 top-3 hidden whitespace-pre rounded-md border border-white/16 bg-black/68 px-3 py-2 font-mono text-[11px] font-semibold leading-[1.55] text-white/78 shadow-[0_8px_24px_rgba(0,0,0,0.42)] backdrop-blur-md"
            aria-label="Performance metrics"
          >
            FPS --  P95 -- ms
          </div>
          <canvas
            ref={sampleCanvas}
            id="sample-canvas"
            class="absolute right-3 top-3 hidden aspect-auto w-[min(16rem,24vw)] max-w-[calc(100vw-24px)] rounded-md border border-white/22 bg-black shadow-[0_12px_34px_rgba(0,0,0,0.48),0_0_0_1px_rgba(0,0,0,0.55)]"
          ></canvas>
          <div
            ref={faceHint}
            id="face-hint"
            class="absolute top-1/2 -translate-y-1/2 rounded-full border border-[#38ff8b]/44 bg-black/58 px-3 py-2.5 font-mono text-sm text-white font-extrabold leading-none shadow-[0_10px_30px_rgba(0,0,0,0.42),0_0_20px_rgba(56,255,139,0.22)] [text-shadow:0_1px_1px_rgba(0,0,0,0.55)]"
            hidden
          ></div>
        </div>
      </section>

      <video
        ref={video}
        id="video"
        playsinline
        webkit-playsinline="true"
        class="native-video absolute inset-0 hidden h-full w-full bg-black object-contain"
        onTimeUpdate={syncTime}
        onLoadedMetadata={syncTime}
        onPlaying={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onVolumeChange={() => {
          const nextVolume = video.muted ? 0 : video.volume
          if (nextVolume > 0) lastAudibleVolume = nextVolume
          setVolume(nextVolume)
        }}
      ></video>

      <Show when={!hasVideo()}>
        <button
          type="button"
          class="absolute inset-0 z-10 grid h-full w-full cursor-pointer place-items-center border-0 bg-black px-6 text-center text-white transition hover:bg-neutral-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-white/70"
          aria-label="Choose video file"
          onClick={openVideoFile}
        >
          <span class="grid -translate-y-[17dvh] justify-items-center gap-6">
            <img src="/icon.svg" alt="Face Cam VR" class="h-24 w-24 drop-shadow-[0_18px_44px_rgba(0,0,0,0.5)] sm:h-32 sm:w-32" />
            <span class="grid gap-3">
              <span class="text-balance text-xl font-semibold tracking-normal sm:text-2xl">Drop a video file here</span>
              <span class="text-balance text-xs font-medium text-white/58 sm:text-sm">or click to choose from your computer</span>
            </span>
          </span>
        </button>
      </Show>

      <aside
        ref={(element) => (controlsZone = element)}
        class="pointer-events-auto absolute inset-x-0 bottom-0 z-20 p-3 sm:p-6"
      >
        <div
          ref={(element) => (controlsPanel = element)}
          class={`pointer-events-auto relative mx-auto grid max-w-6xl gap-3 overflow-visible rounded-[24px] bg-transparent p-3 text-white shadow-none transition duration-300 ease-out sm:p-4 ${
            controlsVisible() ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-4 opacity-0'
          }`}
          onMouseEnter={showControls}
          onFocusIn={showControls}
          onFocusOut={(event) => {
            if (controlsPanel.contains(event.relatedTarget as Node | null)) return
            if (resourcesReady()) scheduleHideControls()
          }}
        >
          <Show when={activeSlider()}>
            {(control) => (
              <LiquidGlass
                class={[glassPillClass, '!absolute z-40 w-fit -translate-x-1/2 rounded-full']}
                style={{
                  left: `${sliderAnchor().x}px`,
                  bottom: `${sliderAnchor().bottom}px`,
                }}
                cornerRadius={999}
                displacementScale={38}
                blurAmount={0.058}
                saturation={150}
                aberrationIntensity={2.2}
                elasticity={0.12}
                castShadow={false}
                onMouseEnter={cancelHideSlider}
                onMouseLeave={() => scheduleHideSlider()}
                onFocusIn={cancelHideSlider}
                onFocusOut={(event) => {
                  if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
                  scheduleHideSlider()
                }}
              >
                <div class="grid justify-items-center gap-2 px-2.5 py-3">
                  <Show when={control() === 'quality'}>
                    <input
                      type="range"
                      min="0"
                      max={QUALITY_OPTIONS.length - 1}
                      step="1"
                      value={qualityId()}
                      aria-label="Quality"
                      title={`Quality: ${QUALITY_OPTIONS[qualityId()]?.label ?? 'Quality'}`}
                      class="vertical-range h-24 w-6 cursor-pointer appearance-none bg-transparent [--fill:rgba(255,255,255,0.82)] [--track:rgba(255,255,255,0.18)]"
                      style={`--progress:${(qualityId() / (QUALITY_OPTIONS.length - 1)) * 100}%`}
                      onInput={(event) => setQualityId(Number(event.currentTarget.value))}
                    />
                  </Show>
                  <Show when={control() === 'volume'}>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.01"
                      value={volume()}
                      aria-label="Volume"
                      class="vertical-range h-24 w-6 cursor-pointer appearance-none bg-transparent [--fill:rgba(255,255,255,0.82)] [--track:rgba(255,255,255,0.18)]"
                      style={`--progress:${volume() * 100}%`}
                      onInput={(event) => setVolumeLevel(Number(event.currentTarget.value))}
                    />
                  </Show>
                  <Show when={control() === 'scale'}>
                    <input
                      type="range"
                      min="0.8"
                      max="2.4"
                      step="0.01"
                      value={zoom()}
                      aria-label="Scale"
                      title={`Scale: ${Math.round(zoom() * 100)}%`}
                      class="vertical-range h-24 w-6 cursor-pointer appearance-none bg-transparent [--fill:rgba(255,255,255,0.82)] [--track:rgba(255,255,255,0.18)]"
                      style={`--progress:${((zoom() - 0.8) / 1.6) * 100}%`}
                      onInput={(event) => setZoom(Number(event.currentTarget.value))}
                    />
                    <button
                      type="button"
                      aria-label="Reset scale"
                      title="Reset scale"
                      class="grid h-7 w-7 cursor-pointer place-items-center rounded-full border-0 bg-white/8 p-0 text-white/82 transition hover:bg-white/14 hover:text-white focus-visible:bg-white/16 focus-visible:outline-none"
                      onClick={resetView}
                    >
                      <Icon name="rotate-ccw" class="h-4 w-4" />
                    </button>
                  </Show>
                </div>
              </LiquidGlass>
            )}
          </Show>

          <div class="grid gap-3 max-sm:grid-cols-[minmax(0,1fr)_auto] max-sm:items-center max-sm:gap-x-3 max-sm:gap-y-2 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:items-center">
            <div class="flex min-w-0 items-center gap-2 overflow-x-auto overscroll-x-contain pb-0.5 [scrollbar-width:none] max-sm:col-start-1 max-sm:row-start-1 max-sm:[&::-webkit-scrollbar]:hidden">
              <LiquidGlass
                class={[glassPillClass, 'h-9 w-36 shrink-0 rounded-full max-sm:w-34']}
                cornerRadius={999}
                displacementScale={34}
                blurAmount={0.055}
                saturation={150}
                aberrationIntensity={2.2}
                elasticity={0.16}
                castShadow={false}
              >
                <label class="box-border flex h-full w-full min-w-0 items-center gap-2 rounded-full px-3">
                  <span class="sr-only">Projection</span>
                  <Icon name="cube-focus" class="h-4 w-4 shrink-0 text-white/78" />
                  <select
                    value={presetId()}
                    class={selectClass}
                    aria-label="Projection"
                    title={`Projection: ${PRESETS[presetId()]?.label ?? 'Projection'}`}
                    onChange={(event) => setPresetId(Number(event.currentTarget.value))}
                  >
                    <For each={PRESETS}>
                      {(preset, index) => (
                        <option value={index()} class="bg-[#1c1c1e] text-white">
                          {preset.label}
                        </option>
                      )}
                    </For>
                  </select>
                  <span aria-hidden="true" class="i-ph-caret-down pointer-events-none h-3.5 w-3.5 shrink-0 text-white/62"></span>
                </label>
              </LiquidGlass>
              <IconButton label="Open video" icon="file-video" onClick={openVideoFile} />
              <Show when={fileName()}>
                {(name) => <p class="min-w-0 truncate text-sm font-medium text-white/86 max-sm:hidden">{name()}</p>}
              </Show>
              <Show when={loadingError()}>
                <button
                  type="button"
                  class="h-8 shrink-0 rounded-full border border-white/14 bg-white/10 px-3 text-xs font-semibold text-white/82 transition hover:bg-white/18 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70"
                  onClick={startInitialLoad}
                >
                  Retry
                </button>
              </Show>
            </div>

            <div class="flex items-center justify-center gap-3 justify-self-center max-sm:col-span-2 max-sm:row-start-2 max-sm:gap-4">
              <IconButton label="Seek backward" icon="rewind" onClick={() => seekBy(-10)} />
              <IconButton
                label={playing() ? 'Pause' : 'Play'}
                icon={playing() ? 'pause' : 'play'}
                iconClass={playing() ? 'h-6.5 w-6.5' : 'h-6.5 w-6.5 translate-x-0.5'}
                class="!h-12 !w-12 text-white/94"
                onClick={togglePlay}
              />
              <IconButton label="Seek forward" icon="fast-forward" onClick={() => seekBy(10)} />
            </div>

            <div class="flex min-w-0 items-center justify-end gap-2 overflow-x-auto overscroll-x-contain pb-0.5 [scrollbar-width:none] max-sm:col-span-2 max-sm:row-start-3 max-sm:w-full max-sm:justify-start max-sm:[&::-webkit-scrollbar]:hidden sm:flex-nowrap lg:justify-end">
              <LiquidGlass
                class={[glassPillClass, 'h-9 shrink-0 rounded-full']}
                cornerRadius={999}
                displacementScale={34}
                blurAmount={0.055}
                saturation={150}
                aberrationIntensity={2.2}
                elasticity={0.16}
                castShadow={false}
                onMouseEnter={cancelHideSlider}
                onMouseLeave={() => scheduleHideSlider()}
              >
                <div class="flex h-full items-center gap-1 px-1">
                  <button
                    type="button"
                    aria-label="Adjust quality"
                    aria-pressed={activeSlider() === 'quality' ? 'true' : 'false'}
                    title={`Quality: ${QUALITY_OPTIONS[qualityId()]?.label ?? 'Quality'}`}
                    class="grid h-7 w-7 cursor-pointer place-items-center rounded-full border-0 bg-transparent p-0 text-white/92 transition hover:bg-white/8 hover:text-white active:scale-95 focus-visible:bg-white/12 focus-visible:outline-none"
                    onMouseEnter={(event) => showSlider('quality', event.currentTarget)}
                    onFocus={(event) => showSlider('quality', event.currentTarget)}
                    onClick={(event) => showSlider('quality', event.currentTarget)}
                  >
                    <Icon name="gauge" class="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    aria-label="Adjust volume"
                    aria-pressed={activeSlider() === 'volume' ? 'true' : 'false'}
                    title={`Volume: ${Math.round(volume() * 100)}%`}
                    class="grid h-7 w-7 cursor-pointer place-items-center rounded-full border-0 bg-transparent p-0 text-white/92 transition hover:bg-white/8 hover:text-white active:scale-95 focus-visible:bg-white/12 focus-visible:outline-none"
                    onMouseEnter={(event) => showSlider('volume', event.currentTarget)}
                    onFocus={(event) => showSlider('volume', event.currentTarget)}
                    onClick={(event) => showSlider('volume', event.currentTarget)}
                  >
                    <Icon name={volume() === 0 ? 'volume-x' : volume() > 0.55 ? 'volume-2' : 'volume-1'} class="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    aria-label="Adjust scale"
                    aria-pressed={activeSlider() === 'scale' ? 'true' : 'false'}
                    title={`Scale: ${Math.round(zoom() * 100)}%`}
                    class="grid h-7 w-7 cursor-pointer place-items-center rounded-full border-0 bg-transparent p-0 text-white/92 transition hover:bg-white/8 hover:text-white active:scale-95 focus-visible:bg-white/12 focus-visible:outline-none"
                    onMouseEnter={(event) => showSlider('scale', event.currentTarget)}
                    onFocus={(event) => showSlider('scale', event.currentTarget)}
                    onClick={(event) => showSlider('scale', event.currentTarget)}
                  >
                    <Icon name="scale" class="h-4 w-4" />
                  </button>
                </div>
              </LiquidGlass>

              <IconButton
                label={videoOnly() ? 'Show panorama' : 'Show video only'}
                icon={videoOnly() ? 'screen-share' : 'video'}
                pressed={videoOnly()}
                onClick={() => setVideoOnly((current) => !current)}
              />
              <IconButton
                label={faceAutoCenter() ? 'Stop face centering' : 'Center detected face'}
                icon="scan-face"
                pressed={faceAutoCenter()}
                onClick={() => setFaceAutoCenter((current) => !current)}
              />
              <IconButton
                label={showDetectionPreview() ? 'Hide detection image' : 'Show detection image'}
                icon="bug"
                pressed={showDetectionPreview()}
                onClick={() => {
                  setShowDetectionPreview((current) => !current)
                  showControls()
                }}
              />
              <IconButton
                label={fullscreen() ? 'Exit fullscreen' : 'Enter fullscreen'}
                icon={fullscreen() ? 'corners-in' : 'corners-out'}
                pressed={fullscreen()}
                onClick={() => void toggleFullscreen()}
              />
            </div>
          </div>

          <div
            class="grid grid-rows-[1.35rem_1rem] gap-1"
            role={resourcesReady() ? undefined : 'status'}
            aria-live={resourcesReady() ? undefined : 'polite'}
          >
            <input
              type="range"
              min="0"
              max={resourcesReady() ? duration() || 0 : 100}
              step={resourcesReady() ? '0.1' : '1'}
              value={resourcesReady() ? currentTime() : loadingPercent()}
              aria-label={resourcesReady() ? 'Playback position' : 'Loading progress'}
              disabled={!resourcesReady()}
              data-loading={resourcesReady() ? undefined : 'true'}
              class="media-range h-[1.35rem] w-full cursor-pointer appearance-none bg-transparent [--fill:rgba(255,255,255,0.82)] [--track:rgba(255,255,255,0.18)]"
              style={`--progress:${resourcesReady() ? progress() : loadingPercent()}%`}
              onInput={(event) => {
                if (!resourcesReady()) return
                if (!duration()) return
                video.currentTime = Number(event.currentTarget.value)
              }}
            />
            <div class="flex h-4 min-w-0 items-center justify-between font-mono text-[11px] leading-4 text-white/48">
              <span class="min-w-0 truncate">{resourcesReady() ? formatTime(currentTime()) : loadingError() ?? loadingLabel()}</span>
              <span class="shrink-0 pl-3 text-right">{resourcesReady() ? formatTime(duration()) : `${loadingPercent()}%`}</span>
            </div>
          </div>
        </div>
      </aside>

      <Show when={debugPanelOpen()}>
        <section class="pointer-events-auto absolute right-3 top-3 z-30 grid max-h-[calc(100dvh-1.5rem)] w-[min(28rem,calc(100vw-1.5rem))] grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-lg border border-white/14 bg-neutral-950/72 text-white shadow-[0_18px_70px_rgba(0,0,0,0.58),inset_0_1px_0_rgba(255,255,255,0.13)] backdrop-blur-2xl sm:right-6 sm:top-6">
          <div class="flex items-center justify-between gap-3 border-b border-white/10 px-3 py-2">
            <div class="min-w-0">
              <p class="truncate text-xs font-semibold text-white/88">{debugStatus()}</p>
              <p class="truncate font-mono text-[10px] text-white/45">local full-range model</p>
            </div>
            <div class="flex items-center gap-2">
              <button
                type="button"
                class="inline-flex h-8 items-center gap-1.5 rounded-full border border-white/10 bg-white/10 px-3 text-xs font-semibold text-white transition hover:bg-white/18 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70"
                onClick={openDebugImageFile}
              >
                <Icon name="upload" class="h-3.5 w-3.5" />
                Upload
              </button>
              <IconButton label="Close debug panel" icon="x" iconClass="h-4 w-4" onClick={() => setDebugPanelOpen(false)} />
            </div>
          </div>

          <div class="min-h-56 overflow-auto p-3">
            <Show
              when={debugImageUrl()}
              fallback={
                <button
                  type="button"
                  class="grid min-h-52 w-full place-items-center rounded-lg border border-dashed border-white/18 bg-white/6 px-4 text-sm font-semibold text-white/72 transition hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70"
                  onClick={openDebugImageFile}
                >
                  Upload image
                </button>
              }
            >
              {(url) => (
                <div class="relative mx-auto w-fit max-w-full overflow-hidden rounded-lg border border-white/10 bg-black">
                  <img
                    ref={debugImage}
                    src={url()}
                    alt=""
                    class="block max-h-[62dvh] max-w-full object-contain"
                    onLoad={detectDebugImage}
                  />
                  <For each={debugFaces()}>
                    {(face) => (
                      <div
                        class="absolute rounded border-2 border-[#38ff8b] shadow-[0_0_0_1px_rgba(0,0,0,0.74),0_0_18px_rgba(56,255,139,0.38),inset_0_0_0_1px_rgba(0,0,0,0.42)]"
                        style={{
                          left: `${face.x * 100}%`,
                          top: `${face.y * 100}%`,
                          width: `${face.width * 100}%`,
                          height: `${face.height * 100}%`,
                        }}
                      >
                        <span class="absolute -left-0.5 top-[-1.35rem] rounded-t bg-[#0a84ff]/90 px-1.25 py-1 font-mono text-[10px] text-white font-bold leading-none [text-shadow:0_1px_1px_rgba(0,0,0,0.45)]">
                          {Math.round(face.score * 100)}%
                        </span>
                      </div>
                    )}
                  </For>
                </div>
              )}
            </Show>
          </div>
        </section>
      </Show>

    </main>
  )
}

render(() => (isChromiumBrowser() ? <App /> : <UnsupportedBrowser />), document.getElementById('root')!)
