import type { PlaylistNode, PlaylistStateNode } from "../playlist/model"
import type { DlnaDevice } from "../sources/fsvr-client"
import type { SubtitleCue } from "../subtitles/parser"
import type { CameraView, VrSceneController } from "../vr/scene"
import { createEffect, createMemo, createSignal, createStore, onSettled } from "solid-js"
import { releaseFaceAutoCenterResources } from "../face-tracking/client"
import {
  applyPlaylistSource,
  buildPlaylistTree,
  firstVideoNode,
  isVideoFile,

  playlistNodesFromTransfer,

} from "../playlist/model"
import { authenticateFsvr, detectFsvr, discoverFsvrDlna, hasFsvrAuth, loadFsvrDlnaDevices, loadFsvrEntries, loadFsvrPlaylist } from "../sources/fsvr-client"
import { activeSubtitleText, parseSubtitle } from "../subtitles/parser"
import {
  createVrScene,
  DEFAULT_ZOOM,
  preloadFaceAutoCenterResources,
  PRESETS,
  QUALITY_OPTIONS,
} from "../vr/scene"

import { createControls } from "./controls"
import { createDisplay } from "./display"

type ValueUpdate<T> = T | ((current: T) => T)
const LOCAL_PLAYLIST_REFRESH_INTERVAL_MS = 10_000
type PlaylistImportPlayback = "always" | "when-empty" | "never"
interface VideoResource { name: string, file?: File, url?: string }
interface SubtitleResource { name: string, file?: File, url?: string }

const resolveUpdate = <T>(current: T, update: ValueUpdate<T>) =>
  typeof update === "function" ? (update as (current: T) => T)(current) : update

const VIDEO_SWITCH_DEBOUNCE_MS = 180
const VIDEO_RELEASE_SETTLE_MS = 160
const VIDEO_EMPTY_TIMEOUT_MS = 1200

export function createPlayerController() {
  let player!: HTMLElement
  let fileInput!: HTMLInputElement
  let folderInput!: HTMLInputElement
  let video!: HTMLVideoElement
  let vrRoot!: HTMLElement
  let vrMount!: HTMLDivElement
  let sampleCanvas!: HTMLCanvasElement
  let faceHint!: HTMLDivElement
  let fpsMeter!: HTMLDivElement

  const viewRef = { current: { yaw: 0, pitch: 0, zoom: DEFAULT_ZOOM, pausedUntil: 0 } satisfies CameraView }
  let scene: VrSceneController | undefined
  let fileUrl: string | undefined
  let lastAudibleVolume = 1
  let videoLoadGeneration = 0
  let videoSwitchTimer: number | undefined
  let videoSwitchInProgress = false
  let pendingVideoSwitch: { resource: VideoResource, playlistId?: string } | undefined
  let autoplayPending = false
  let playlistImportGeneration = 0
  let resourcesInitialized = false
  const playlistFiles = new Map<string, File>()
  const playlistUrls = new Map<string, string>()
  const playlistRemoteFolders = new Map<string, { path: string, sourceId: string }>()
  const playlistSubtitles = new Map<string, File>()
  const playlistSubtitleUrls = new Map<string, { name: string, url: string }>()

  const [fileName, setFileName] = createSignal<string>()
  const [serverState, setServerState] = createStore({
    endpoint: "",
    status: "disconnected" as "disconnected" | "connecting" | "authentication-required" | "connected" | "error",
    error: undefined as string | undefined,
    dlnaDevices: [] as DlnaDevice[],
    scanningDlna: false,
  })
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
    if (node.mediaUrl) playlistUrls.set(node.id, node.mediaUrl)
    if (node.remoteSourceId !== undefined && node.remotePath !== undefined) {
      playlistRemoteFolders.set(node.id, { path: node.remotePath, sourceId: node.remoteSourceId })
    }
    if (node.subtitleFile) playlistSubtitles.set(node.id, node.subtitleFile)
    if (node.subtitleUrl) playlistSubtitleUrls.set(node.id, { name: node.subtitleName ?? "subtitle.srt", url: node.subtitleUrl })
    return {
      id: node.id,
      name: node.name,
      kind: node.kind === "folder" ? "folder" : "video",
      sourceKind: node.sourceKind,
      hasSubtitle: Boolean(node.subtitleFile || node.subtitleUrl),
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
  const [subtitleCues, setSubtitleCues] = createSignal<SubtitleCue[]>([])
  const [subtitlesEnabled, setSubtitlesEnabled] = createSignal(true)
  const [subtitleFileName, setSubtitleFileName] = createSignal<string>()
  const [debugPanelOpen, setDebugPanelOpen] = createSignal(false)
  const [loadingState, setLoadingState] = createStore({
    resourcesReady: true,
    progress: 100,
    label: "Ready",
    error: undefined as string | undefined,
  })
  const resourcesReady = () => loadingState.resourcesReady
  const loadingProgress = () => loadingState.progress
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
  const displayModule = createDisplay({
    getPlayer: () => player,
    resourcesReady,
    viewRef,
  })
  const {
    changeQualityBy,
    faceAutoCenter,
    presetId,
    qualityId,
    splitScreen,
    syncFullscreen,
    syncZoom,
  } = displayModule
  const {
    resetView,
    setPresetId,
    setZoom,
    toggleFullscreen,
    zoom,
  } = displayModule.controller
  const controlsModule = createControls({ hasVideo, playlistOpen, resourcesReady })
  const {
    activeSlider,
    cancelHideSlider,
    controlsVisible,
    cursorVisible,
    dispose: disposeControls,
    handlePlayerMouseMove,
    scheduleHideControls,
    scheduleHideSlider,
    setActiveSlider,
    showControls,
    showSlider,
    sliderAnchor,
    startInitialIdleCountdown,
  } = controlsModule
  const playlistVisible = createMemo(() => playlistOpen() && controlsVisible())
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
      nodes.forEach(node => (node.kind === "video" ? videos.push(node) : visit(node.children ?? [])))
    }
    visit(playlist())
    return videos
  })

  const sceneOptions = () => ({
    preset: PRESETS[presetId()].component,
    quality: QUALITY_OPTIONS[qualityId()].component,
    hidden: false,
    splitScreen: splitScreen(),
    faceAutoCenter: faceAutoCenter(),
    debugPanelOpen: debugPanelOpen(),
  })

  const showVideoTranslationLayer = () => {
    video.classList.remove("hidden")
    video.classList.add("block")
    video.classList.add("opacity-[0.01]", "pointer-events-none")
    video.dataset.displayMode = "vr-translation-layer"
  }

  const syncTime = () => {
    setCurrentTime(video.currentTime || 0)
    setDuration(video.duration || 0)
  }

  const subtitleText = createMemo(() => subtitlesEnabled()
    ? activeSubtitleText(subtitleCues(), currentTime())
    : "")

  const loadSubtitle = async (resource: SubtitleResource | undefined, generation: number) => {
    if (!resource) {
      setSubtitleCues([])
      setSubtitleFileName(undefined)
      return
    }
    try {
      const text = resource.file
        ? await resource.file.text()
        : await fetch(resource.url!).then((response) => {
            if (!response.ok) throw new Error(`subtitle request failed (${response.status})`)
            return response.text()
          })
      const cues = parseSubtitle(text, resource.name)
      if (generation !== videoLoadGeneration || appDisposed) return
      setSubtitleCues(cues)
      setSubtitleFileName(resource.name)
    } catch (error) {
      if (generation !== videoLoadGeneration || appDisposed) return
      setSubtitleCues([])
      setSubtitleFileName(undefined)
      console.warn("subtitle loading failed", error)
    }
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

  function openVideoFile() {
    fileInput.click()
  }
  const requestVideoPlayback = (generation = videoLoadGeneration) => {
    if (generation !== videoLoadGeneration) return
    if (!video.currentSrc && !video.getAttribute("src")) return
    autoplayPending = false
    void video.play().catch((error) => {
      if (generation !== videoLoadGeneration || (error instanceof DOMException && error.name === "AbortError")) return
      console.warn("video playback could not start", error)
    })
  }

  const detachCurrentVideoSource = async () => {
    const previousUrl = fileUrl
    fileUrl = undefined
    video.pause()

    if (video.currentSrc || video.getAttribute("src")) {
      await new Promise<void>((resolve) => {
        let completed = false
        let timeout: number
        const finish = () => {
          if (completed) return
          completed = true
          window.clearTimeout(timeout)
          video.removeEventListener("emptied", finish)
          resolve()
        }
        timeout = window.setTimeout(finish, VIDEO_EMPTY_TIMEOUT_MS)
        video.addEventListener("emptied", finish, { once: true })
        video.removeAttribute("src")
        video.load()
      })
    } else {
      video.removeAttribute("src")
      video.load()
    }

    if (previousUrl) URL.revokeObjectURL(previousUrl)
    if (!appDisposed) {
      await new Promise<void>(resolve => window.setTimeout(resolve, VIDEO_RELEASE_SETTLE_MS))
    }
  }

  const commitVideoResource = async (resource: VideoResource, playlistId?: string) => {
    const generation = ++videoLoadGeneration
    scene?.resetMedia()
    await detachCurrentVideoSource()
    if (appDisposed || generation !== videoLoadGeneration || pendingVideoSwitch) return
    fileUrl = resource.file ? URL.createObjectURL(resource.file) : undefined
    setHasVideo(true)
    setPlaying(false)
    setCurrentTime(0)
    setDuration(0)
    setFileName(resource.name)
    setSelectedPlaylistId(playlistId && (playlistFiles.has(playlistId) || playlistUrls.has(playlistId)) ? playlistId : undefined)
    const subtitleFile = playlistId ? playlistSubtitles.get(playlistId) : undefined
    const remoteSubtitle = playlistId ? playlistSubtitleUrls.get(playlistId) : undefined
    void loadSubtitle(
      subtitleFile
        ? { name: subtitleFile.name, file: subtitleFile }
        : remoteSubtitle,
      generation,
    )
    video.src = fileUrl ?? resource.url ?? ""
    video.load()
    if (resourcesInitialized && resourcesReady()) {
      requestVideoPlayback(generation)
      startInitialIdleCountdown()
    }
  }

  const processPendingVideoSwitch = async () => {
    if (videoSwitchInProgress) return
    videoSwitchInProgress = true
    try {
      while (pendingVideoSwitch) {
        if (appDisposed) break
        const pending = pendingVideoSwitch
        pendingVideoSwitch = undefined
        await commitVideoResource(pending.resource, pending.playlistId)
      }
    } finally {
      videoSwitchInProgress = false
    }
  }

  const scheduleVideoSwitch = (playlistId?: string) => {
    autoplayPending = true
    setSelectedPlaylistId(playlistId)

    if (videoSwitchTimer !== undefined) window.clearTimeout(videoSwitchTimer)
    videoSwitchTimer = window.setTimeout(() => {
      videoSwitchTimer = undefined
      void processPendingVideoSwitch()
    }, fileUrl || videoSwitchInProgress ? VIDEO_SWITCH_DEBOUNCE_MS : 0)
  }

  const loadVideoFile = (file: File, playlistId?: string) => {
    if (!isVideoFile(file)) return
    pendingVideoSwitch = { resource: { name: file.name, file }, playlistId }
    scheduleVideoSwitch(playlistId)
  }

  const loadVideoUrl = (url: string, name: string, playlistId?: string) => {
    pendingVideoSwitch = { resource: { name, url }, playlistId }
    scheduleVideoSwitch(playlistId)
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
    playlistUrls.clear()
    playlistRemoteFolders.clear()
    playlistSubtitles.clear()
    playlistSubtitleUrls.clear()
    setPlaylistState((draft) => {
      draft.nodes = []
      draft.expandedFolderIds = []
      draft.selectedId = undefined
    })
  }

  const playPlaylistNode = (id: string) => {
    const file = playlistFiles.get(id)
    if (file) {
      loadVideoFile(file, id)
    } else {
      const url = playlistUrls.get(id)
      const node = playlistVideos().find(candidate => candidate.id === id)
      if (url && node) loadVideoUrl(url, node.name, id)
    }
  }

  const countPlaylistVideos = (nodes: PlaylistNode[]): number => nodes.reduce(
    (count, node) => count + (node.kind === "video" ? 1 : countPlaylistVideos(node.children ?? [])),
    0,
  )

  const importPlaylistNodes = (nodes: PlaylistNode[], playback: PlaylistImportPlayback) => {
    if (!nodes.length) return
    const firstVideo = firstVideoNode(nodes)
    if (playback === "always" && !firstVideo?.file && !firstVideo?.mediaUrl) return

    appendPlaylist(nodes)
    setExpandedFolders((current) => {
      const next = new Set(current)
      nodes.forEach(node => node.kind === "folder" && node.remoteSourceId === undefined && next.add(node.id))
      return next
    })

    if (countPlaylistVideos(nodes) > 1) {
      setPlaylistOpen(true)
      showControls()
    }

    const shouldLoadImportedVideo = !playing() && (firstVideo?.file || firstVideo?.mediaUrl)
      && (playback === "always" || (playback === "when-empty" && !hasVideo()))
    if (shouldLoadImportedVideo && firstVideo) {
      if (firstVideo.file) loadVideoFile(firstVideo.file, firstVideo.id)
      else if (firstVideo.mediaUrl) loadVideoUrl(firstVideo.mediaUrl, firstVideo.name, firstVideo.id)
    }
  }

  const importPlaylistTransfer = async (dataTransfer: DataTransfer, playback: PlaylistImportPlayback) => {
    const importGeneration = playlistImportGeneration
    try {
      const nodes = await playlistNodesFromTransfer(dataTransfer)
      if (appDisposed || importGeneration !== playlistImportGeneration) return
      importPlaylistNodes(nodes, playback)
    } catch (error) {
      console.warn("video import failed", error)
    }
  }

  const handleFile = () => {
    const files = Array.from(fileInput.files ?? [])
    fileInput.value = ""
    importPlaylistNodes(buildPlaylistTree(files), "always")
  }

  const handleFolder = () => {
    const files = Array.from(folderInput.files ?? [])
    folderInput.value = ""
    importPlaylistNodes(buildPlaylistTree(files), "when-empty")
  }

  const findPlaylistStateNode = (nodes: PlaylistStateNode[], id: string): PlaylistStateNode | undefined => {
    for (const node of nodes) {
      if (node.id === id) return node
      const nested = findPlaylistStateNode(node.children ?? [], id)
      if (nested) return nested
    }
  }

  const loadRemoteFolder = async (id: string) => {
    const remoteFolder = playlistRemoteFolders.get(id)
    if (!remoteFolder || serverState.status !== "connected") return
    const nodes = await loadFsvrEntries(serverState.endpoint, remoteFolder.sourceId, remoteFolder.path)
    setPlaylistState((draft) => {
      const visit = (items: PlaylistStateNode[]): boolean => {
        for (const item of items) {
          if (item.id === id) {
            if (item.sourceKind) applyPlaylistSource(nodes, item.sourceKind)
            const previousChildren = item.children ?? []
            item.children = serializePlaylistNodes(nodes).map((child) => {
              if (child.kind !== "folder") return child
              const previous = previousChildren.find(candidate => candidate.id === child.id)
              if (previous?.children) child.children = previous.children
              return child
            })
            return true
          }
          if (item.children && visit(item.children)) return true
        }
        return false
      }
      visit(draft.nodes)
    })
  }

  const togglePlaylistFolder = (id: string) => {
    const shouldLoad = playlistRemoteFolders.has(id) && !findPlaylistStateNode(playlist(), id)?.children
    setExpandedFolders((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    if (shouldLoad) void loadRemoteFolder(id).catch(error => console.warn("remote folder loading failed", error))
  }

  const refreshLoadedLocalFolders = async () => {
    if (serverState.status !== "connected") return
    const loadedFolderIds: string[] = []
    const visit = (nodes: PlaylistStateNode[]) => {
      for (const node of nodes) {
        const remoteFolder = playlistRemoteFolders.get(node.id)
        if (node.kind === "folder" && node.children && remoteFolder?.sourceId === "local") loadedFolderIds.push(node.id)
        if (node.children) visit(node.children)
      }
    }
    visit(playlist())
    await Promise.all(loadedFolderIds.map(id => loadRemoteFolder(id)))
  }

  const playNextPlaylistVideo = () => {
    const videos = playlistVideos()
    const currentIndex = videos.findIndex(node => node.id === selectedPlaylistId())
    if (currentIndex < 0) return
    const next = videos[currentIndex + 1]
    if (next) playPlaylistNode(next.id)
  }

  const handleVideoDrop = async (event: DragEvent) => {
    event.preventDefault()
    setFrameDragActive(false)
    const dataTransfer = event.dataTransfer
    if (!dataTransfer) return
    await importPlaylistTransfer(dataTransfer, "always")
  }

  const loadServerPlaylist = async () => {
    const [nodes, dlnaDevices] = await Promise.all([
      loadFsvrPlaylist(serverState.endpoint),
      loadFsvrDlnaDevices(serverState.endpoint),
    ])
    if (appDisposed) return
    clearPlaylist()
    importPlaylistNodes(nodes, "when-empty")
    setPlaylistOpen(true)
    setServerState((draft) => {
      draft.status = "connected"
      draft.error = undefined
      draft.dlnaDevices = dlnaDevices
    })
  }

  const authenticateServer = async (password: string) => {
    if (!password.trim()) throw new Error("Enter a password")
    setServerState((draft) => {
      draft.status = "connecting"
      draft.error = undefined
    })
    try {
      await authenticateFsvr(serverState.endpoint || window.location.origin, password)
      await loadServerPlaylist()
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid password"
      clearPlaylist()
      setServerState((draft) => {
        draft.status = "authentication-required"
        draft.error = message
      })
      throw error
    }
  }

  const connectServer = async () => {
    const endpoint = window.location.origin
    const pageUrl = new URL(window.location.href)
    const urlPassword = pageUrl.searchParams.get("password")
    if (urlPassword !== null) {
      pageUrl.searchParams.delete("password")
      window.history.replaceState(window.history.state, "", `${pageUrl.pathname}${pageUrl.search}${pageUrl.hash}`)
    }
    setServerState((draft) => {
      draft.endpoint = endpoint
      draft.status = "connecting"
      draft.error = undefined
    })
    try {
      if (!(await detectFsvr(endpoint))) {
        setServerState((draft) => {
          draft.status = "disconnected"
        })
        return
      }
      if (urlPassword) {
        await authenticateServer(urlPassword)
        return
      }
      if (!(await hasFsvrAuth(endpoint))) {
        setServerState((draft) => {
          draft.status = "authentication-required"
        })
        return
      }
      await loadServerPlaylist()
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to connect to fsvr"
      setServerState((draft) => {
        draft.status = "error"
        draft.error = message
      })
      throw error
    }
  }

  const scanDlna = async () => {
    if (serverState.status !== "connected") throw new Error("Connect to fsvr before scanning DLNA")
    setServerState((draft) => {
      draft.scanningDlna = true
      draft.error = undefined
    })
    try {
      await discoverFsvrDlna(serverState.endpoint)
      const [nodes, devices] = await Promise.all([
        loadFsvrPlaylist(serverState.endpoint),
        loadFsvrDlnaDevices(serverState.endpoint),
      ])
      if (appDisposed) return
      clearPlaylist()
      importPlaylistNodes(nodes, "when-empty")
      setPlaylistOpen(true)
      setServerState((draft) => {
        draft.dlnaDevices = devices
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : "DLNA scan failed"
      setServerState((draft) => {
        draft.error = message
      })
      throw error
    } finally {
      setServerState((draft) => {
        draft.scanningDlna = false
      })
    }
  }

  const handleKeydown = (event: KeyboardEvent) => {
    if (!resourcesReady()) {
      event.preventDefault()
      return
    }

    const target = event.target
    const isTyping
      = target instanceof HTMLInputElement
        || target instanceof HTMLSelectElement
        || target instanceof HTMLTextAreaElement
        || (target instanceof HTMLElement && target.isContentEditable)
    if (isTyping) return

    const seekAmount = event.shiftKey ? 60 : 10

    switch (event.key) {
      case " ":
      case "k":
      case "K":
        event.preventDefault()
        togglePlay()
        break
      case "ArrowLeft":
      case "j":
      case "J":
        event.preventDefault()
        seekBy(-seekAmount)
        break
      case "ArrowRight":
      case "l":
      case "L":
        event.preventDefault()
        seekBy(seekAmount)
        break
      case "ArrowUp":
        event.preventDefault()
        setVolumeLevel(volume() + 0.05)
        break
      case "ArrowDown":
        event.preventDefault()
        setVolumeLevel(volume() - 0.05)
        break
      case "m":
      case "M":
        toggleMute()
        break
      case "f":
      case "F":
        void toggleFullscreen()
        break
      case "r":
      case "R":
        resetView()
        break
      case "[":
      case "-":
        setZoom(zoom() - 0.1)
        break
      case "]":
      case "=":
        setZoom(zoom() + 0.1)
        break
      case ",":
        changeQualityBy(-1)
        break
      case ".":
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

  const startInitialLoad = () => {
    if (loadingPromise || resourcesInitialized) return

    loadingPromise = (async () => {
      setResourcesReady(false)
      setLoadingError(undefined)
      setLoadingLabel("Preparing player")
      setLoadingProgress(4)

      try {
        await preloadFaceAutoCenterResources(({ loaded, total, label }) => {
          if (appDisposed) return
          setLoadingLabel(label)
          setLoadingProgress(8 + (loaded / total) * 82)
        })
        if (appDisposed) return

        setLoadingLabel("Starting renderer")
        setLoadingProgress(96)
        scene = createVrScene({
          root: vrRoot,
          mount: vrMount,
          sampleCanvas,
          hintElement: faceHint,
          fpsElement: fpsMeter,
          video,
          viewRef,
          onZoomChange: syncZoom,
          ...sceneOptions(),
        })
        showVideoTranslationLayer()
        setLoadingLabel("Ready")
        setLoadingProgress(100)
        resourcesInitialized = true
        setResourcesReady(true)
        if (hasVideo()) {
          if (autoplayPending) requestVideoPlayback()
          startInitialIdleCountdown()
        }
      } catch (error) {
        if (appDisposed) return
        console.warn("initial resource loading failed", error)
        setLoadingError("Resource loading failed")
        setLoadingLabel("Unable to load resources")
      }
    })().finally(() => {
      loadingPromise = undefined
    })
  }

  onSettled(() => {
    window.addEventListener("keydown", handleKeydown)
    document.addEventListener("fullscreenchange", syncFullscreen)

    void connectServer().catch(error => console.warn("fsvr connection failed", error))
    const localPlaylistRefreshTimer = window.setInterval(() => {
      void refreshLoadedLocalFolders().catch(error => console.warn("local playlist refresh failed", error))
    }, LOCAL_PLAYLIST_REFRESH_INTERVAL_MS)

    return () => {
      appDisposed = true
      window.removeEventListener("keydown", handleKeydown)
      document.removeEventListener("fullscreenchange", syncFullscreen)
      window.clearInterval(localPlaylistRefreshTimer)
      if (videoSwitchTimer !== undefined) window.clearTimeout(videoSwitchTimer)
      pendingVideoSwitch = undefined
      autoplayPending = false
      playlistImportGeneration += 1
      disposeControls()
      scene?.destroy()
      releaseFaceAutoCenterResources()
      videoLoadGeneration += 1
      video.pause()
      video.removeAttribute("src")
      video.load()
      if (fileUrl) URL.revokeObjectURL(fileUrl)
      fileUrl = undefined
    }
  })

  createEffect(
    () => hasVideo(),
    (videoSelected) => {
      if (videoSelected) startInitialLoad()
    },
  )

  createEffect(
    () => sceneOptions(),
    (options) => {
      scene?.update(options)
      showVideoTranslationLayer()
    },
  )

  const handleVolumeChange = () => {
    const nextVolume = video.muted ? 0 : video.volume
    if (nextVolume > 0) lastAudibleVolume = nextVolume
    setVolume(nextVolume)
  }

  const seekTo = (time: number) => {
    const total = duration()
    if (!resourcesReady() || !total) return
    const nextTime = Math.min(total, Math.max(0, time))
    video.currentTime = nextTime
    setCurrentTime(nextTime)
  }

  return {
    frame: {
      chooseFolder: () => folderInput.click(),
      cursorVisible,
      frameDragActive,
      handleFile,
      handleFolder,
      handlePlayerMouseMove,
      handleVideoDrop,
      hasVideo,
      openVideoFile,
      setFileInput: (element: HTMLInputElement) => (fileInput = element),
      setFolderInput: (element: HTMLInputElement) => (folderInput = element),
      setFrameDragActive,
      setPlayer: (element: HTMLElement) => (player = element),
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
      visible: playlistVisible,
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
    subtitles: {
      enabled: subtitlesEnabled,
      fileName: subtitleFileName,
      hasSubtitle: () => subtitleCues().length > 0,
      text: subtitleText,
      toggle: () => setSubtitlesEnabled(current => !current),
    },
    display: displayModule.controller,
    controls: {
      activeSlider,
      cancelHideSlider,
      containsControlsPanel: controlsModule.containsControlsPanel,
      controlsVisible,
      scheduleHideControls,
      scheduleHideSlider,
      setActiveSlider,
      setControlsPanel: controlsModule.setControlsPanel,
      setControlsZone: controlsModule.setControlsZone,
      showControls,
      showSlider,
      sliderAnchor,
    },
    debug: {
      panelOpen: debugPanelOpen,
      setFaceHint: (element: HTMLDivElement) => (faceHint = element),
      setFpsMeter: (element: HTMLDivElement) => (fpsMeter = element),
      setPanelOpen: setDebugPanelOpen,
      setSampleCanvas: (element: HTMLCanvasElement) => (sampleCanvas = element),
    },
    server: {
      authenticate: authenticateServer,
      scanDlna,
      state: serverState,
    },
  }
}

export type PlayerController = ReturnType<typeof createPlayerController>
