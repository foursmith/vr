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
type PlaylistNode = {
  id: string
  name: string
  kind: 'folder' | 'video'
  file?: File
  children?: PlaylistNode[]
}
type DragFileEntry = {
  isFile: true
  isDirectory: false
  name: string
  file: (success: (file: File) => void, error?: (error: DOMException) => void) => void
}
type DragDirectoryReader = {
  readEntries: (success: (entries: DragEntry[]) => void, error?: (error: DOMException) => void) => void
}
type DragDirectoryEntry = {
  isFile: false
  isDirectory: true
  name: string
  createReader: () => DragDirectoryReader
}
type DragEntry = DragFileEntry | DragDirectoryEntry
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
  columns: 'i-ph-columns',
  'fast-forward': 'i-ph-fast-forward',
  'file-video': 'i-ph-file-video',
  folder: 'i-ph-folder',
  'folder-open': 'i-ph-folder-open',
  gauge: 'i-ph-gauge',
  pause: 'i-ph-pause',
  play: 'i-ph-play',
  playlist: 'i-ph-playlist',
  plus: 'i-ph-plus',
  rewind: 'i-ph-rewind',
  scale: 'i-ph-magnifying-glass-plus',
  'rotate-ccw': 'i-ph-arrow-counter-clockwise',
  'scan-face': 'i-ph-scan-smiley',
  'screen-share': 'i-ph-screencast',
  upload: 'i-ph-upload',
  video: 'i-ph-video',
  trash: 'i-ph-trash',
  'volume-1': 'i-ph-speaker-simple-low',
  'volume-2': 'i-ph-speaker-simple-high',
  'volume-x': 'i-ph-speaker-simple-x',
  x: 'i-ph-x',
} as const

let playlistNodeSequence = 0

const createPlaylistId = () => `playlist-${playlistNodeSequence++}`

const isVideoFile = (file: File) =>
  file.type.startsWith('video/') || /\.(mp4|m4v|mov|webm|mkv|avi|ogv|mpeg|mpg)$/i.test(file.name)

const sortPlaylistNodes = (nodes: PlaylistNode[]) =>
  nodes.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
  })

const buildPlaylistTree = (files: File[]) => {
  const roots: PlaylistNode[] = []

  for (const file of files.filter(isVideoFile)) {
    const relativePath = file.webkitRelativePath || file.name
    const parts = relativePath.split('/').filter(Boolean)
    let level = roots

    for (const folderName of parts.slice(0, -1)) {
      let folder = level.find((node) => node.kind === 'folder' && node.name === folderName)
      if (!folder) {
        folder = { id: createPlaylistId(), name: folderName, kind: 'folder', children: [] }
        level.push(folder)
      }
      level = folder.children!
    }

    level.push({ id: createPlaylistId(), name: parts.at(-1) ?? file.name, kind: 'video', file })
  }

  const sortLevel = (nodes: PlaylistNode[]) => {
    sortPlaylistNodes(nodes)
    nodes.forEach((node) => node.children && sortLevel(node.children))
  }
  sortLevel(roots)
  return roots
}

const readDragDirectory = (entry: DragDirectoryEntry) =>
  new Promise<DragEntry[]>((resolve, reject) => {
    const reader = entry.createReader()
    const entries: DragEntry[] = []
    const readBatch = () => {
      reader.readEntries((batch) => {
        if (!batch.length) {
          resolve(entries)
          return
        }
        entries.push(...batch)
        readBatch()
      }, reject)
    }
    readBatch()
  })

const PLAYLIST_IMPORT_BATCH_SIZE = 24

async function playlistNodesFromEntries(entries: DragEntry[]) {
  const nodes: PlaylistNode[] = []

  for (let index = 0; index < entries.length; index += PLAYLIST_IMPORT_BATCH_SIZE) {
    const batch = entries.slice(index, index + PLAYLIST_IMPORT_BATCH_SIZE)
    const batchNodes = (await Promise.all(batch.map(playlistNodeFromEntry))).filter(
      (node): node is PlaylistNode => Boolean(node),
    )
    nodes.push(...batchNodes)
  }

  return nodes
}

const playlistNodeFromEntry = async (entry: DragEntry): Promise<PlaylistNode | undefined> => {
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) => entry.file(resolve, reject))
    return isVideoFile(file) ? { id: createPlaylistId(), name: file.name, kind: 'video', file } : undefined
  }

  const children = await playlistNodesFromEntries(await readDragDirectory(entry))
  if (!children.length) return undefined
  sortPlaylistNodes(children)
  return { id: createPlaylistId(), name: entry.name, kind: 'folder', children }
}

type IconName = keyof typeof ICONS
type SliderControl = 'quality' | 'volume' | 'scale'
type SliderAnchor = { x: number; bottom: number }

const CONTROL_IDLE_HIDE_DELAY = 1800
const CURSOR_IDLE_HIDE_DELAY = 1800
const INITIAL_CONTROL_HIDE_DELAY = 3600
const VIDEO_SWITCH_DEBOUNCE_MS = 180
const VIDEO_RELEASE_SETTLE_MS = 160
const VIDEO_EMPTY_TIMEOUT_MS = 1200

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

function PlaylistTreeNode(props: {
  node: PlaylistNode
  depth: number
  expanded: Set<string>
  selectedId?: string
  onToggle: (id: string) => void
  onSelect: (node: PlaylistNode) => void
}) {
  const isExpanded = () => props.expanded.has(props.node.id)

  return (
    <li
      role="treeitem"
      aria-expanded={props.node.kind === 'folder' ? (isExpanded() ? 'true' : 'false') : undefined}
      aria-selected={props.node.id === props.selectedId ? 'true' : 'false'}
    >
      <button
        type="button"
        class={`playlist-tree-row group relative flex h-8 w-full min-w-0 cursor-pointer items-center gap-1.5 rounded-md border-0 pr-2 text-left text-xs transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-white/70 ${
          props.node.id === props.selectedId
            ? 'bg-white/15 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]'
            : 'bg-transparent text-white/68 hover:bg-white/8 hover:text-white/92'
        }`}
        style={{ 'padding-left': `${8 + props.depth * 16}px` }}
        title={props.node.name}
        onClick={() => (props.node.kind === 'folder' ? props.onToggle(props.node.id) : props.onSelect(props.node))}
      >
        <Show
          when={props.node.kind === 'folder'}
          fallback={<span aria-hidden="true" class="h-3.5 w-3.5 shrink-0"></span>}
        >
          <span
            aria-hidden="true"
            class={`i-ph-caret-right h-3.5 w-3.5 shrink-0 text-white/42 transition-transform ${isExpanded() ? 'rotate-90' : ''}`}
          ></span>
        </Show>
        <Icon
          name={props.node.kind === 'folder' ? (isExpanded() ? 'folder-open' : 'folder') : 'file-video'}
          class={`h-4 w-4 shrink-0 ${props.node.kind === 'folder' ? 'text-[#80c7ff]' : 'text-white/52 group-hover:text-white/74'}`}
        />
        <span class="min-w-0 flex-1 truncate">{props.node.name}</span>
        <Show when={props.node.id === props.selectedId}>
          <span aria-label="Playing" class="flex h-3 items-end gap-[2px] text-[#63b8ff]">
            <i class="playlist-eq h-2 w-[2px] rounded-full bg-current"></i>
            <i class="playlist-eq h-3 w-[2px] rounded-full bg-current [animation-delay:-.35s]"></i>
            <i class="playlist-eq h-1.5 w-[2px] rounded-full bg-current [animation-delay:-.7s]"></i>
          </span>
        </Show>
      </button>
      <Show when={props.node.kind === 'folder' && isExpanded()}>
        <ul role="group" class="m-0 list-none p-0">
          <For each={props.node.children ?? []}>
            {(child) => (
              <PlaylistTreeNode
                node={child}
                depth={props.depth + 1}
                expanded={props.expanded}
                selectedId={props.selectedId}
                onToggle={props.onToggle}
                onSelect={props.onSelect}
              />
            )}
          </For>
        </ul>
      </Show>
    </li>
  )
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
          <LiquidGlass
            class="pointer-events-none !absolute bottom-1 h-1.5 w-1.5 rounded-full"
            style={{ left: 'calc(50% - 0.1875rem)' }}
            cornerRadius={999}
            displacementScale={8}
            blurAmount={0.04}
            saturation={155}
            aberrationIntensity={1.2}
            elasticity={0}
            active
            castShadow={false}
          >
            <span class="block h-full w-full rounded-full border border-white/34 bg-white/20 shadow-[inset_0_1px_0_rgba(255,255,255,0.68),0_0_5px_rgba(255,255,255,0.18)]"></span>
          </LiquidGlass>
        </Show>
      </button>
    </LiquidGlass>
  )
}

function VerticalGlassRange(props: {
  min: number
  max: number
  step: number
  value: number
  progress: number
  label: string
  title?: string
  onInput: (value: number) => void
}) {
  const progress = () => Math.min(100, Math.max(0, props.progress))

  return (
    <div
      class="relative h-24 w-6 [--fill:rgba(255,255,255,0.82)] [--track:rgba(255,255,255,0.18)]"
      style={`--progress:${progress()}%`}
    >
      <span
        aria-hidden="true"
        class="pointer-events-none absolute inset-y-0 left-1/2 w-[0.28rem] -translate-x-1/2 overflow-hidden rounded-full"
        style={{ background: 'var(--track)' }}
      >
        <span
          class="absolute inset-x-0 bottom-0 rounded-full"
          style={{ height: 'var(--progress)', background: 'var(--fill)' }}
        ></span>
      </span>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        aria-label={props.label}
        title={props.title}
        class="vertical-range absolute inset-0 z-10 h-24 w-6 cursor-pointer appearance-none bg-transparent"
        onInput={(event) => props.onInput(Number(event.currentTarget.value))}
      />
      <LiquidGlass
        class="liquid-glass-range-thumb pointer-events-none !absolute z-20 h-4 w-4 rounded-full"
        style={{
          left: 'calc(50% - 0.5rem)',
          top: 'calc(100% - var(--progress) - 0.5rem)',
        }}
        cornerRadius={999}
        displacementScale={12}
        blurAmount={0.05}
        saturation={155}
        aberrationIntensity={1.5}
        elasticity={0}
        active
        castShadow={false}
      >
        <span
          aria-hidden="true"
          class="block h-full w-full rounded-full border border-white/34 bg-[linear-gradient(145deg,rgba(255,255,255,0.26),rgba(255,255,255,0.12))] shadow-[inset_0_1px_1px_rgba(255,255,255,0.68),0_2px_8px_rgba(0,0,0,0.24)]"
        ></span>
      </LiquidGlass>
    </div>
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
  let folderInput!: HTMLInputElement
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
  let videoLoadGeneration = 0
  let videoSwitchTimer: number | undefined
  let videoSwitchInProgress = false
  let pendingVideoSwitch: { file: File; playlistId?: string } | undefined

  const [fileName, setFileName] = createSignal<string>()
  const [playlist, setPlaylist] = createSignal<PlaylistNode[]>([])
  const [expandedFolders, setExpandedFolders] = createSignal(new Set<string>())
  const [selectedPlaylistId, setSelectedPlaylistId] = createSignal<string>()
  const [playlistDragActive, setPlaylistDragActive] = createSignal(false)
  const [playlistOpen, setPlaylistOpen] = createSignal(false)
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
  const [splitScreen, setSplitScreen] = createSignal(true)
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
  const playlistVideos = createMemo(() => {
    const videos: PlaylistNode[] = []
    const visit = (nodes: PlaylistNode[]) => {
      nodes.forEach((node) => (node.kind === 'video' ? videos.push(node) : visit(node.children ?? [])))
    }
    visit(playlist())
    return videos
  })

  const sceneOptions = () => ({
    preset: PRESETS[presetId()].component,
    quality: QUALITY_OPTIONS[qualityId()].component,
    hidden: videoOnly(),
    splitScreen: splitScreen(),
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

  const detachCurrentVideoSource = async () => {
    const previousUrl = fileUrl
    fileUrl = undefined
    video.pause()

    if (video.currentSrc || video.getAttribute('src')) {
      await new Promise<void>((resolve) => {
        let completed = false
        const finish = () => {
          if (completed) return
          completed = true
          window.clearTimeout(timeout)
          video.removeEventListener('emptied', finish)
          resolve()
        }
        const timeout = window.setTimeout(finish, VIDEO_EMPTY_TIMEOUT_MS)
        video.addEventListener('emptied', finish, { once: true })
        video.removeAttribute('src')
        video.load()
      })
    } else {
      video.removeAttribute('src')
      video.load()
    }

    if (previousUrl) URL.revokeObjectURL(previousUrl)
    if (!appDisposed) {
      await new Promise<void>((resolve) => window.setTimeout(resolve, VIDEO_RELEASE_SETTLE_MS))
    }
  }

  const commitVideoFile = async (file: File, playlistId?: string) => {
    const generation = ++videoLoadGeneration
    scene?.resetMedia()
    await detachCurrentVideoSource()
    if (appDisposed || pendingVideoSwitch) return
    fileUrl = URL.createObjectURL(file)
    setHasVideo(true)
    setPlaying(false)
    setCurrentTime(0)
    setDuration(0)
    setFileName(file.name)
    setSelectedPlaylistId(playlistId)
    video.src = fileUrl
    video.load()
    if (resourcesReady()) {
      void video.play().catch((error) => {
        if (generation !== videoLoadGeneration || error instanceof DOMException && error.name === 'AbortError') return
        console.warn('video playback could not start', error)
      })
      startInitialIdleCountdown()
    }
  }

  const processPendingVideoSwitch = async () => {
    if (videoSwitchInProgress) return
    videoSwitchInProgress = true
    try {
      while (pendingVideoSwitch && !appDisposed) {
        const pending = pendingVideoSwitch
        pendingVideoSwitch = undefined
        await commitVideoFile(pending.file, pending.playlistId)
      }
    } finally {
      videoSwitchInProgress = false
    }
  }

  const loadVideoFile = (file: File, playlistId?: string) => {
    if (!isVideoFile(file)) return
    pendingVideoSwitch = { file, playlistId }
    setSelectedPlaylistId(playlistId)

    if (videoSwitchTimer !== undefined) window.clearTimeout(videoSwitchTimer)
    videoSwitchTimer = window.setTimeout(() => {
      videoSwitchTimer = undefined
      void processPendingVideoSwitch()
    }, fileUrl || videoSwitchInProgress ? VIDEO_SWITCH_DEBOUNCE_MS : 0)
  }

  const handleFile = () => {
    const file = fileInput.files?.[0]
    if (!file) return
    const node: PlaylistNode = { id: createPlaylistId(), name: file.name, kind: 'video', file }
    setPlaylist((current) => [...current, node])
    loadVideoFile(file, node.id)
    fileInput.value = ''
  }

  const handleFolder = () => {
    const nodes = buildPlaylistTree(Array.from(folderInput.files ?? []))
    if (!nodes.length) return
    setPlaylist((current) => [...current, ...nodes])
    setExpandedFolders((current) => {
      const next = new Set(current)
      nodes.forEach((node) => node.kind === 'folder' && next.add(node.id))
      return next
    })
    folderInput.value = ''
  }

  const togglePlaylistFolder = (id: string) => {
    setExpandedFolders((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handlePlaylistDrop = async (event: DragEvent) => {
    event.preventDefault()
    event.stopPropagation()
    setPlaylistDragActive(false)
    const items = Array.from(event.dataTransfer?.items ?? [])
    const entries = items
      .map((item) => (item as unknown as { webkitGetAsEntry?: () => DragEntry | null }).webkitGetAsEntry?.())
      .filter((entry): entry is DragEntry => Boolean(entry))

    try {
      const nodes = entries.length
        ? await playlistNodesFromEntries(entries)
        : buildPlaylistTree(Array.from(event.dataTransfer?.files ?? []))
      if (!nodes.length) return
      sortPlaylistNodes(nodes)
      setPlaylist((current) => [...current, ...nodes])
      setExpandedFolders((current) => {
        const next = new Set(current)
        nodes.forEach((node) => node.kind === 'folder' && next.add(node.id))
        return next
      })
    } catch (error) {
      console.warn('playlist folder import failed', error)
    }
  }

  const playNextPlaylistVideo = () => {
    const videos = playlistVideos()
    const currentIndex = videos.findIndex((node) => node.id === selectedPlaylistId())
    const next = videos[currentIndex + 1]
    if (next?.file) loadVideoFile(next.file, next.id)
  }

  const handleVideoDrop = (event: DragEvent) => {
    event.preventDefault()
    const file = Array.from(event.dataTransfer?.files ?? []).find((item) => item.type.startsWith('video/'))
    if (!file) return
    const node: PlaylistNode = { id: createPlaylistId(), name: file.name, kind: 'video', file }
    setPlaylist((current) => [...current, node])
    loadVideoFile(file, node.id)
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
      if (videoSwitchTimer !== undefined) window.clearTimeout(videoSwitchTimer)
      pendingVideoSwitch = undefined
      cancelHideControls()
      cancelHideCursor()
      cancelHideSlider()
      scene?.destroy()
      releaseFaceAutoCenterResources()
      videoLoadGeneration += 1
      video.pause()
      video.removeAttribute('src')
      video.load()
      if (fileUrl) URL.revokeObjectURL(fileUrl)
      fileUrl = undefined
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
      <input
        ref={folderInput}
        type="file"
        accept="video/*"
        multiple
        class="hidden"
        {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
        onChange={handleFolder}
      />
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
        onEnded={playNextPlaylistVideo}
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

      <div
        class={`pointer-events-auto absolute bottom-40 left-3 top-3 z-30 w-[min(15rem,calc(100vw-1.5rem))] transition-[transform,opacity] duration-300 ease-[cubic-bezier(.22,.8,.24,1)] sm:bottom-6 sm:left-6 sm:top-6 sm:w-72 ${
          playlistOpen() ? 'translate-x-0 opacity-100' : 'pointer-events-none -translate-x-[calc(100%+1.5rem)] opacity-0'
        }`}
        aria-hidden={playlistOpen() ? 'false' : 'true'}
        inert={!playlistOpen()}
      >
        <LiquidGlass
          class={`h-full w-full rounded-[20px] text-white transition-shadow ${
            playlistDragActive() ? 'shadow-[0_0_0_3px_rgba(99,184,255,0.2)]' : ''
          }`}
          cornerRadius={20}
          displacementScale={46}
          blurAmount={0.06}
          saturation={150}
          aberrationIntensity={2.2}
          elasticity={0}
          active={playlistDragActive()}
          castShadow
        >
          <aside
            class="flex h-full w-full flex-col overflow-hidden rounded-[20px] border border-white/12 text-white"
            aria-label="Playlist"
            onDragEnter={(event) => {
              event.preventDefault()
              event.stopPropagation()
              setPlaylistDragActive(true)
            }}
            onDragOver={(event) => {
              event.preventDefault()
              event.stopPropagation()
              if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
            }}
            onDragLeave={(event) => {
              event.stopPropagation()
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setPlaylistDragActive(false)
            }}
            onDrop={(event) => void handlePlaylistDrop(event)}
          >
            <header class="flex h-14 shrink-0 items-center gap-2 border-b border-white/9 px-3">
              <span class="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/8 text-white/78 shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]">
                <Icon name="playlist" class="h-4.5 w-4.5" />
              </span>
              <div class="min-w-0 flex-1">
                <h2 class="text-sm font-semibold tracking-tight text-white/94">播放列表</h2>
                <p class="mt-0.5 text-[10px] text-white/42">{playlistVideos().length} 个视频</p>
              </div>
              <IconButton
                label="清空播放列表"
                icon="trash"
                iconClass="h-3.5 w-3.5"
                class={`!h-8 !w-8 ${playlist().length ? '' : 'pointer-events-none opacity-25'}`}
                onClick={() => {
                  setPlaylist([])
                  setExpandedFolders(new Set<string>())
                  setSelectedPlaylistId(undefined)
                }}
              />
              <IconButton label="关闭播放列表" icon="x" iconClass="h-3.5 w-3.5" class="!h-8 !w-8" onClick={() => setPlaylistOpen(false)} />
            </header>

            <div class="playlist-scroll min-h-0 flex-1 overflow-y-auto px-2 py-2">
              <Show
                when={playlist().length}
                fallback={
                  <button
                    type="button"
                    class={`grid min-h-full w-full cursor-pointer place-content-center justify-items-center gap-3 rounded-xl border border-dashed px-5 py-10 text-center transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-white/70 ${
                      playlistDragActive()
                        ? 'border-[#63b8ff]/70 bg-[#63b8ff]/10 text-white'
                        : 'border-white/14 bg-white/[0.025] text-white/58 hover:border-white/25 hover:bg-white/5 hover:text-white/78'
                    }`}
                    onClick={() => folderInput.click()}
                  >
                    <span class="grid h-11 w-11 place-items-center rounded-full border border-white/10 bg-white/7 text-white/72 shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]">
                      <Icon name="folder" class="h-5.5 w-5.5" />
                    </span>
                    <span class="grid gap-1">
                      <strong class="text-xs font-semibold text-current">拖入视频文件夹</strong>
                      <span class="text-[10px] leading-4 text-white/38">保留嵌套目录结构</span>
                    </span>
                  </button>
                }
              >
                <ul role="tree" aria-label="视频文件夹" class="m-0 list-none p-0">
                  <For each={playlist()}>
                    {(node) => (
                      <PlaylistTreeNode
                        node={node}
                        depth={0}
                        expanded={expandedFolders()}
                        selectedId={selectedPlaylistId()}
                        onToggle={togglePlaylistFolder}
                        onSelect={(selected) => selected.file && loadVideoFile(selected.file, selected.id)}
                      />
                    )}
                  </For>
                </ul>
              </Show>
            </div>

            <footer class="shrink-0 border-t border-white/9 p-2">
              <LiquidGlass
                class="h-9 w-full rounded-full text-white"
                cornerRadius={999}
                displacementScale={32}
                blurAmount={0.052}
                saturation={150}
                aberrationIntensity={2.2}
                elasticity={0.12}
                castShadow={false}
              >
                <button
                  type="button"
                  class="flex h-full w-full cursor-pointer items-center justify-center gap-2 rounded-full border-0 bg-transparent px-3 text-xs font-semibold text-white/78 transition hover:text-white focus-visible:bg-white/10 focus-visible:outline-none"
                  onClick={() => folderInput.click()}
                >
                  <Icon name="plus" class="h-3.5 w-3.5" />
                  添加文件夹
                </button>
              </LiquidGlass>
            </footer>
          </aside>
        </LiquidGlass>
      </div>

      <aside
        ref={(element) => (controlsZone = element)}
        class={`pointer-events-auto absolute inset-x-0 bottom-0 z-20 p-3 transition-[padding] duration-300 sm:p-6 ${
          playlistOpen() ? 'sm:pl-[20rem]' : ''
        }`}
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
                    <VerticalGlassRange
                      min={0}
                      max={QUALITY_OPTIONS.length - 1}
                      step={1}
                      value={qualityId()}
                      progress={(qualityId() / (QUALITY_OPTIONS.length - 1)) * 100}
                      label="Quality"
                      title={`Quality: ${QUALITY_OPTIONS[qualityId()]?.label ?? 'Quality'}`}
                      onInput={setQualityId}
                    />
                  </Show>
                  <Show when={control() === 'volume'}>
                    <VerticalGlassRange
                      min={0}
                      max={1}
                      step={0.01}
                      value={volume()}
                      progress={volume() * 100}
                      label="Volume"
                      onInput={setVolumeLevel}
                    />
                  </Show>
                  <Show when={control() === 'scale'}>
                    <VerticalGlassRange
                      min={0.8}
                      max={2.4}
                      step={0.01}
                      value={zoom()}
                      progress={((zoom() - 0.8) / 1.6) * 100}
                      label="Scale"
                      title={`Scale: ${Math.round(zoom() * 100)}%`}
                      onInput={setZoom}
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
              <IconButton
                label="播放列表"
                icon="playlist"
                pressed={playlistOpen()}
                onClick={() => setPlaylistOpen((current) => !current)}
              />
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
                label={splitScreen() ? 'Disable automatic split screen' : 'Enable automatic split screen'}
                icon="columns"
                pressed={splitScreen()}
                onClick={() => setSplitScreen((current) => !current)}
              />
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
            <div
              class="relative h-[1.35rem] w-full [--fill:rgba(255,255,255,0.82)] [--track:rgba(255,255,255,0.18)]"
              style={`--progress:${resourcesReady() ? progress() : loadingPercent()}%`}
            >
              <span
                aria-hidden="true"
                class="pointer-events-none absolute inset-x-0 top-1/2 h-[0.28rem] -translate-y-1/2 overflow-hidden rounded-full"
                style={{ background: 'var(--track)' }}
              >
                <span class="block h-full rounded-full" style={{ width: 'var(--progress)', background: 'var(--fill)' }}></span>
              </span>
              <input
                type="range"
                min="0"
                max={resourcesReady() ? duration() || 0 : 100}
                step={resourcesReady() ? '0.1' : '1'}
                value={resourcesReady() ? currentTime() : loadingPercent()}
                aria-label={resourcesReady() ? 'Playback position' : 'Loading progress'}
                disabled={!resourcesReady()}
                class="media-range absolute inset-0 z-10 h-[1.35rem] w-full cursor-pointer appearance-none bg-transparent"
                onInput={(event) => {
                  if (!resourcesReady()) return
                  if (!duration()) return
                  video.currentTime = Number(event.currentTarget.value)
                }}
              />
              <Show when={resourcesReady()}>
                <LiquidGlass
                  class="liquid-glass-range-thumb pointer-events-none !absolute z-20 h-4 w-4 rounded-full"
                  style={{
                    left: 'calc(var(--progress) - 0.5rem)',
                    top: 'calc(50% - 0.5rem)',
                  }}
                  cornerRadius={999}
                  displacementScale={12}
                  blurAmount={0.05}
                  saturation={155}
                  aberrationIntensity={1.5}
                  elasticity={0}
                  active
                  castShadow={false}
                >
                  <span
                    aria-hidden="true"
                    class="block h-full w-full rounded-full border border-white/34 bg-[linear-gradient(145deg,rgba(255,255,255,0.26),rgba(255,255,255,0.12))] shadow-[inset_0_1px_1px_rgba(255,255,255,0.68),0_2px_8px_rgba(0,0,0,0.24)]"
                  ></span>
                </LiquidGlass>
              </Show>
            </div>
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
