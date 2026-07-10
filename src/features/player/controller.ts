import { createEffect, createMemo, createSignal, createStore, onSettled } from 'solid-js'
import {
  DEFAULT_ZOOM,
  PRESETS,
  QUALITY_OPTIONS,
  createVrScene,
  preloadFaceAutoCenterResources,
  type CameraView,
  type VrSceneController,
} from '../vr/scene'
import { releaseFaceAutoCenterResources } from '../face-tracking/client'
import { getDebugDetector, releaseDebugDetector, type DebugFace } from '../face-tracking/debug-detector'
import {
  buildPlaylistTree,
  firstVideoNode,
  isVideoFile,
  playlistNodesFromTransfer,
  type PlaylistNode,
  type PlaylistStateNode,
} from '../playlist/model'

type SliderControl = 'quality' | 'volume' | 'scale'
type SliderAnchor = { x: number; bottom: number }
type ValueUpdate<T> = T | ((current: T) => T)
type PlaylistImportPlayback = 'always' | 'when-empty' | 'never'

const resolveUpdate = <T>(current: T, update: ValueUpdate<T>) =>
  typeof update === 'function' ? (update as (current: T) => T)(current) : update

const CONTROL_IDLE_HIDE_DELAY = 1800
const CURSOR_IDLE_HIDE_DELAY = 1800
const INITIAL_CONTROL_HIDE_DELAY = 3600
const VIDEO_SWITCH_DEBOUNCE_MS = 180
const VIDEO_RELEASE_SETTLE_MS = 160
const VIDEO_EMPTY_TIMEOUT_MS = 1200

export function createPlayerController() {
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
  let debugImageGeneration = 0
  let hideControlsTimer: number | undefined
  let hideCursorTimer: number | undefined
  let hideSliderTimer: number | undefined
  let pointerInControlZone = false
  let lastAudibleVolume = 1
  let videoLoadGeneration = 0
  let videoSwitchTimer: number | undefined
  let videoSwitchInProgress = false
  let pendingVideoSwitch: { file: File; playlistId?: string } | undefined
  let autoplayPending = false
  let playlistImportGeneration = 0
  const playlistFiles = new Map<string, File>()

  const [fileName, setFileName] = createSignal<string>()
  const [frameDragActive, setFrameDragActive] = createSignal(false)
  const [playlistState, setPlaylistState] = createStore({
    nodes: [] as PlaylistStateNode[],
    expandedFolderIds: [] as string[],
    selectedId: undefined as string | undefined,
    open: false,
  })
  const playlist = () => playlistState.nodes
  const expandedFolders = createMemo(() => new Set(playlistState.expandedFolderIds))
  const selectedPlaylistId = () => playlistState.selectedId
  const playlistOpen = () => playlistState.open
  const serializePlaylistNodes = (nodes: PlaylistNode[]): PlaylistStateNode[] => nodes.map((node) => {
    if (node.file) playlistFiles.set(node.id, node.file)
    return {
      id: node.id,
      name: node.name,
      kind: node.kind,
      children: node.children ? serializePlaylistNodes(node.children) : undefined,
    }
  })
  const appendPlaylist = (nodes: PlaylistNode[]) => setPlaylistState((draft) => {
    draft.nodes.push(...serializePlaylistNodes(nodes))
  })
  const setExpandedFolders = (update: ValueUpdate<Set<string>>) => setPlaylistState((draft) => {
    const current = new Set(Array.from(draft.expandedFolderIds))
    draft.expandedFolderIds = Array.from(resolveUpdate(current, update))
  })
  const setSelectedPlaylistId = (selectedId: string | undefined) => setPlaylistState((draft) => {
    draft.selectedId = selectedId
  })
  const setPlaylistOpen = (update: ValueUpdate<boolean>) => setPlaylistState((draft) => {
    draft.open = resolveUpdate(draft.open, update)
  })
  const [hasVideo, setHasVideo] = createSignal(false)
  const [playing, setPlaying] = createSignal(false)
  const [currentTime, setCurrentTime] = createSignal(0)
  const [duration, setDuration] = createSignal(0)
  const [volume, setVolume] = createSignal(1)
  const [displayState, setDisplayState] = createStore({
    presetId: 0,
    qualityId: 2,
    videoOnly: false,
    splitScreen: true,
    faceAutoCenter: true,
    showDetectionPreview: false,
  })
  const presetId = () => displayState.presetId
  const qualityId = () => displayState.qualityId
  const [zoom, setZoomSignal] = createSignal(DEFAULT_ZOOM)
  const [activeSlider, setActiveSlider] = createSignal<SliderControl>()
  const [sliderAnchor, setSliderAnchor] = createSignal<SliderAnchor>({ x: 0, bottom: 72 })
  const videoOnly = () => displayState.videoOnly
  const splitScreen = () => displayState.splitScreen
  const faceAutoCenter = () => displayState.faceAutoCenter
  const showDetectionPreview = () => displayState.showDetectionPreview
  const setDisplayValue = <K extends keyof typeof displayState>(key: K, update: ValueUpdate<(typeof displayState)[K]>) => {
    setDisplayState((draft) => {
      draft[key] = resolveUpdate(draft[key], update)
    })
  }
  const setPresetId = (update: ValueUpdate<number>) => setDisplayValue('presetId', update)
  const setQualityId = (update: ValueUpdate<number>) => setDisplayValue('qualityId', update)
  const setVideoOnly = (update: ValueUpdate<boolean>) => setDisplayValue('videoOnly', update)
  const setSplitScreen = (update: ValueUpdate<boolean>) => setDisplayValue('splitScreen', update)
  const setFaceAutoCenter = (update: ValueUpdate<boolean>) => setDisplayValue('faceAutoCenter', update)
  const setShowDetectionPreview = (update: ValueUpdate<boolean>) => setDisplayValue('showDetectionPreview', update)
  const [controlsVisible, setControlsVisible] = createSignal(true)
  const [cursorVisible, setCursorVisible] = createSignal(true)
  const [fullscreen, setFullscreen] = createSignal(false)
  const [debugPanelOpen, setDebugPanelOpen] = createSignal(false)
  const [debugImageUrl, setDebugImageUrl] = createSignal<string | undefined>()
  const [debugFaces, setDebugFaces] = createSignal<DebugFace[]>([])
  const [debugStatus, setDebugStatus] = createSignal('Upload image')
  const [debugImageNeedsDetection, setDebugImageNeedsDetection] = createSignal(false)
  const [loadingState, setLoadingState] = createStore({
    resourcesReady: false,
    progress: 0,
    label: 'Preparing to start',
    error: undefined as string | undefined,
  })
  const resourcesReady = () => loadingState.resourcesReady
  const loadingProgress = () => loadingState.progress
  const loadingLabel = () => loadingState.label
  const loadingError = () => loadingState.error
  const setResourcesReady = (resourcesReady: boolean) => setLoadingState((draft) => {
    draft.resourcesReady = resourcesReady
  })
  const setLoadingProgress = (progress: number) => setLoadingState((draft) => {
    draft.progress = progress
  })
  const setLoadingLabel = (label: string) => setLoadingState((draft) => {
    draft.label = label
  })
  const setLoadingError = (error: string | undefined) => setLoadingState((draft) => {
    draft.error = error
  })
  let loadingPromise: Promise<void> | undefined
  let appDisposed = false

  const progress = createMemo(() => {
    const total = duration()
    return total ? Math.min(100, Math.max(0, (currentTime() / total) * 100)) : 0
  })

  const loadingPercent = createMemo(() => Math.round(Math.min(100, Math.max(0, loadingProgress()))))
  const playlistVideos = createMemo(() => {
    const videos: PlaylistStateNode[] = []
    const visit = (nodes: PlaylistStateNode[]) => {
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

  const requestVideoPlayback = (generation = videoLoadGeneration) => {
    if (generation !== videoLoadGeneration) return
    if (!video.currentSrc && !video.getAttribute('src')) return
    autoplayPending = false
    void video.play().catch((error) => {
      if (generation !== videoLoadGeneration || error instanceof DOMException && error.name === 'AbortError') return
      console.warn('video playback could not start', error)
    })
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
    if (appDisposed || generation !== videoLoadGeneration || pendingVideoSwitch) return
    fileUrl = URL.createObjectURL(file)
    setHasVideo(true)
    setPlaying(false)
    setCurrentTime(0)
    setDuration(0)
    setFileName(file.name)
    setSelectedPlaylistId(playlistId && playlistFiles.has(playlistId) ? playlistId : undefined)
    video.src = fileUrl
    video.load()
    if (resourcesReady()) {
      requestVideoPlayback(generation)
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
    autoplayPending = true
    setSelectedPlaylistId(playlistId)

    if (videoSwitchTimer !== undefined) window.clearTimeout(videoSwitchTimer)
    videoSwitchTimer = window.setTimeout(() => {
      videoSwitchTimer = undefined
      void processPendingVideoSwitch()
    }, fileUrl || videoSwitchInProgress ? VIDEO_SWITCH_DEBOUNCE_MS : 0)
  }

  const clearPlaylist = () => {
    const switchInProgress = videoSwitchInProgress
    if (videoSwitchTimer !== undefined) {
      window.clearTimeout(videoSwitchTimer)
      videoSwitchTimer = undefined
    }
    pendingVideoSwitch = undefined
    if (!switchInProgress) autoplayPending = false
    playlistImportGeneration += 1
    playlistFiles.clear()
    setPlaylistState((draft) => {
      draft.nodes = []
      draft.expandedFolderIds = []
      draft.selectedId = undefined
    })
  }

  const playPlaylistNode = (id: string) => {
    const file = playlistFiles.get(id)
    if (file) loadVideoFile(file, id)
  }

  const importPlaylistNodes = (nodes: PlaylistNode[], playback: PlaylistImportPlayback) => {
    if (!nodes.length) return
    const firstVideo = firstVideoNode(nodes)
    if (playback === 'always' && !firstVideo?.file) return

    appendPlaylist(nodes)
    setExpandedFolders((current) => {
      const next = new Set(current)
      nodes.forEach((node) => node.kind === 'folder' && next.add(node.id))
      return next
    })

    if (firstVideo?.file && (playback === 'always' || (playback === 'when-empty' && !hasVideo()))) {
      loadVideoFile(firstVideo.file, firstVideo.id)
    }
  }

  const importPlaylistTransfer = async (dataTransfer: DataTransfer, playback: PlaylistImportPlayback) => {
    const importGeneration = playlistImportGeneration
    try {
      const nodes = await playlistNodesFromTransfer(dataTransfer)
      if (appDisposed || importGeneration !== playlistImportGeneration) return
      importPlaylistNodes(nodes, playback)
    } catch (error) {
      console.warn('video import failed', error)
    }
  }

  const handleFile = () => {
    const files = Array.from(fileInput.files ?? [])
    fileInput.value = ''
    importPlaylistNodes(buildPlaylistTree(files), 'always')
  }

  const handleFolder = () => {
    const files = Array.from(folderInput.files ?? [])
    folderInput.value = ''
    importPlaylistNodes(buildPlaylistTree(files), 'when-empty')
  }

  const togglePlaylistFolder = (id: string) => {
    setExpandedFolders((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const playNextPlaylistVideo = () => {
    const videos = playlistVideos()
    const currentIndex = videos.findIndex((node) => node.id === selectedPlaylistId())
    if (currentIndex < 0) return
    const next = videos[currentIndex + 1]
    if (next) playPlaylistNode(next.id)
  }

  const handleVideoDrop = async (event: DragEvent) => {
    event.preventDefault()
    setFrameDragActive(false)
    const dataTransfer = event.dataTransfer
    if (!dataTransfer) return
    await importPlaylistTransfer(dataTransfer, 'always')
  }

  const handleDebugImage = () => {
    if (!resourcesReady()) return
    const file = debugImageInput.files?.[0]
    debugImageInput.value = ''
    if (!file) return
    debugImageGeneration += 1
    if (debugImageUrlRef) URL.revokeObjectURL(debugImageUrlRef)
    debugImageUrlRef = URL.createObjectURL(file)
    setDebugImageUrl(debugImageUrlRef)
    setDebugImageNeedsDetection(true)
    setDebugFaces([])
    setDebugStatus('Loading image')
    setDebugPanelOpen(true)
  }

  const closeDebugPanel = () => {
    debugImageGeneration += 1
    debugImage = undefined
    if (debugImageUrlRef) URL.revokeObjectURL(debugImageUrlRef)
    debugImageUrlRef = undefined
    debugImageInput.value = ''
    setDebugImageUrl(undefined)
    setDebugImageNeedsDetection(false)
    setDebugFaces([])
    setDebugStatus('Upload image')
    setDebugPanelOpen(false)
  }

  const detectDebugImage = async () => {
    if (!resourcesReady()) return
    const image = debugImage
    if (!image || !debugImageNeedsDetection() || !image.naturalWidth || !image.naturalHeight) return

    const generation = debugImageGeneration
    setDebugImageNeedsDetection(false)
    setDebugStatus('Running detector')
    setDebugFaces([])

    try {
      const detector = await getDebugDetector()
      if (appDisposed || generation !== debugImageGeneration || image !== debugImage) return
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
      if (appDisposed || generation !== debugImageGeneration) return
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
        if (hasVideo()) {
          if (autoplayPending) requestVideoPlayback()
          startInitialIdleCountdown()
        }
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
      autoplayPending = false
      playlistImportGeneration += 1
      cancelHideControls()
      cancelHideCursor()
      cancelHideSlider()
      scene?.destroy()
      releaseFaceAutoCenterResources()
      releaseDebugDetector()
      videoLoadGeneration += 1
      video.pause()
      video.removeAttribute('src')
      video.load()
      if (fileUrl) URL.revokeObjectURL(fileUrl)
      fileUrl = undefined
      if (debugImageUrlRef) URL.revokeObjectURL(debugImageUrlRef)
      debugImageUrlRef = undefined
      debugImageGeneration += 1
      debugImage = undefined
    }
  })

  createEffect(
    () => sceneOptions(),
    (options) => {
      scene?.update(options)
      updateVideoVisibility(options.hidden)
    },
  )

  const handleVolumeChange = () => {
    const nextVolume = video.muted ? 0 : video.volume
    if (nextVolume > 0) lastAudibleVolume = nextVolume
    setVolume(nextVolume)
  }

  const seekTo = (time: number) => {
    if (!resourcesReady() || !duration()) return
    video.currentTime = time
  }

  return {
    frame: {
      chooseFolder: () => folderInput.click(),
      cursorVisible,
      frameDragActive,
      handleDebugImage,
      handleFile,
      handleFolder,
      handlePlayerMouseMove,
      handleVideoDrop,
      hasVideo,
      openVideoFile,
      setDebugImageInput: (element: HTMLInputElement) => (debugImageInput = element),
      setFaceHint: (element: HTMLDivElement) => (faceHint = element),
      setFileInput: (element: HTMLInputElement) => (fileInput = element),
      setFolderInput: (element: HTMLInputElement) => (folderInput = element),
      setFpsMeter: (element: HTMLDivElement) => (fpsMeter = element),
      setFrameDragActive,
      setPlayer: (element: HTMLElement) => (player = element),
      setSampleCanvas: (element: HTMLCanvasElement) => (sampleCanvas = element),
      setVideo: (element: HTMLVideoElement) => (video = element),
      setVrMount: (element: HTMLDivElement) => (vrMount = element),
      setVrRoot: (element: HTMLElement) => (vrRoot = element),
    },
    playlist: {
      chooseFiles: () => fileInput.click(),
      chooseFolder: () => folderInput.click(),
      clearPlaylist,
      expandedFolders,
      playPlaylistNode,
      playlistVideos,
      setPlaylistOpen,
      state: playlistState,
      togglePlaylistFolder,
    },
    playback: {
      currentTime,
      duration,
      fileName,
      handleVolumeChange,
      loadingPercent,
      loadingState,
      openVideoFile,
      playNextPlaylistVideo,
      playing,
      progress,
      seekBy,
      seekTo,
      setPlaying,
      setVolumeLevel,
      startInitialLoad,
      syncTime,
      togglePlay,
      volume,
    },
    display: {
      fullscreen,
      resetView,
      setFaceAutoCenter,
      setPresetId,
      setQualityId,
      setShowDetectionPreview,
      setSplitScreen,
      setVideoOnly,
      setZoom,
      state: displayState,
      toggleFullscreen,
      zoom,
    },
    controls: {
      activeSlider,
      cancelHideSlider,
      containsControlsPanel: (node: Node | null) => controlsPanel.contains(node),
      controlsVisible,
      scheduleHideControls,
      scheduleHideSlider,
      setActiveSlider,
      setControlsPanel: (element: HTMLDivElement) => (controlsPanel = element),
      setControlsZone: (element: HTMLElement) => (controlsZone = element),
      showControls,
      showSlider,
      sliderAnchor,
    },
    debug: {
      closeDebugPanel,
      debugFaces,
      debugImageUrl,
      debugPanelOpen,
      debugStatus,
      detectDebugImage,
      openDebugImageFile,
      setDebugImage: (element: HTMLImageElement) => (debugImage = element),
    },
  }
}

export type PlayerController = ReturnType<typeof createPlayerController>
