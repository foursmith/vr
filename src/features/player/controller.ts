import type { PlaylistNode, PlaylistStateNode } from "../playlist/model"
import type { DlnaDevice } from "../sources/fsvr-client"
import type { SubtitleCue } from "../subtitles/parser"
import type { CameraView, ProjectionBoundaryWarning, VrSceneController } from "../vr/scene"
import type { LastPlayback, RepeatMode } from "./playback-state"
import { createEffect, createMemo, createSignal, createStore, onSettled } from "solid-js"
import {
  applyPlaylistSource,
  buildPlaylistTree,
  firstVideoNode,
  isVideoFile,

  playlistNodesFromTransfer,
  videosInPlaybackFolder,

} from "../playlist/model"
import { authenticateFsvr, detectFsvr, discoverFsvrDlna, hasFsvrAuth, loadFsvrDlnaDevices, loadFsvrEntries, loadFsvrPlaylist } from "../sources/fsvr-client"
import { isFsvrHostMode } from "../sources/fsvr-runtime"
import { activeSubtitleText, parseSubtitle } from "../subtitles/parser"
import { DEFAULT_FORWARD, DEFAULT_ZOOM, PROJECTION_OPTIONS, QUALITY_OPTIONS } from "../vr/config"
import { createAbLoopController } from "./ab-loop/controller"
import { createControls } from "./controls"
import { createDisplay } from "./display"
import { DEFAULT_GLOBAL_PREFERENCES, fsvrMediaIdentity, loadGlobalPreferences, loadLastPlayback, loadVideoPlaybackState, saveGlobalPreferences, saveLastPlayback, saveVideoPlaybackState, videoStateKey } from "./playback-state"

export type { RepeatMode } from "./playback-state"

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
const VIDEO_STATE_SAVE_INTERVAL_MS = 10_000
const LAST_PLAYBACK_SAVE_INTERVAL_MS = 1_000
export const VIDEO_FRAME_RATE_OPTIONS = [
  { label: "24 fps", value: 24 },
  { label: "30 fps", value: 30 },
  { label: "60 fps", value: 60 },
] as const
const EXPORT_VIDEO_BIT_RATES = [2_000_000, 4_000_000, 8_000_000, 12_000_000] as const

const playlistFolderIds = (nodes: PlaylistNode[], targetId: string, folderIds: string[] = []): string[] | undefined => {
  for (const node of nodes) {
    if (node.id === targetId) return folderIds
    if (node.kind !== "folder") continue
    const found = playlistFolderIds(node.children ?? [], targetId, [...folderIds, node.id])
    if (found) return found
  }
}

const decodeBase64Url = (value: string) => {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/")
  const bytes = Uint8Array.from(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "=")), character => character.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

const encodeBase64Url = (value: string) => {
  let binary = ""
  new TextEncoder().encode(value).forEach(byte => (binary += String.fromCharCode(byte)))
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "")
}

const localFsvrVideoLocation = (entryId: string) => {
  try {
    const path = decodeBase64Url(entryId)
    const separator = path.includes("\\") && !path.includes("/") ? "\\" : "/"
    const parts = path.split(/[\\/]/).filter(Boolean)
    const name = parts.pop()
    if (!name) return
    let parentPath = ""
    const folderIds = ["source:local", ...parts.map((part) => {
      parentPath = parentPath ? `${parentPath}${separator}${part}` : part
      return `local:${encodeBase64Url(parentPath)}`
    })]
    return { folderIds, name }
  } catch {
    // Ignore malformed local entry IDs from stale playback data.
  }
}

export function createPlayerController(options: { connectFsvr?: boolean } = {}) {
  const connectFsvr = options.connectFsvr ?? isFsvrHostMode
  const initialPreferences = loadGlobalPreferences()
  let player!: HTMLElement
  let fileInput!: HTMLInputElement
  let folderInput!: HTMLInputElement
  let video!: HTMLVideoElement
  let vrRoot!: HTMLElement
  let vrMount!: HTMLDivElement
  let sampleCanvas!: HTMLCanvasElement
  let faceHint!: HTMLDivElement
  let fpsMeter!: HTMLDivElement

  const viewRef = { current: { yaw: 0, pitch: 0, zoom: DEFAULT_ZOOM, forward: DEFAULT_FORWARD, pausedUntil: 0 } satisfies CameraView }
  let scene: VrSceneController | undefined
  let fileUrl: string | undefined
  let lastAudibleVolume = initialPreferences.volume || DEFAULT_GLOBAL_PREFERENCES.volume
  let videoLoadGeneration = 0
  let videoSwitchTimer: number | undefined
  let projectionBoundaryWarningTimer: number | undefined
  let videoSwitchInProgress = false
  let pendingVideoSwitch: { resource: VideoResource, playlistId?: string } | undefined
  let autoplayPending = false
  let activeVideoKey: string | undefined
  let videoStateSaveTimer: number | undefined
  let lastPlayback = loadLastPlayback()
  let lastPlaybackSavedAt = 0
  let pendingResumeTime: number | undefined
  let suppressNextPauseActivity = false
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
  const [playlistState, setPlaylistState] = createStore({
    nodes: [] as PlaylistStateNode[],
    expandedFolderIds: [] as string[],
    selectedId: undefined as string | undefined,
  })
  const playlist = () => playlistState.nodes
  const canImportLocalMedia = () => !connectFsvr || serverState.status === "connected"
  const expandedFolders = createMemo(() => new Set(playlistState.expandedFolderIds))
  const selectedPlaylistId = () => playlistState.selectedId
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
  const refreshDlnaPlaylist = (nodes: PlaylistNode[]) => {
    const dlnaNodes = serializePlaylistNodes(nodes.filter(node => node.sourceKind === "dlna"))
    setPlaylistState((draft) => {
      const isBrowserRoot = (node: PlaylistStateNode) =>
        node.sourceKind === "browser" || playlistFiles.has(node.id)
      const previousDlnaNodes = new Map(
        draft.nodes
          .filter(node => node.sourceKind === "dlna")
          .map(node => [node.id, node]),
      )
      dlnaNodes.forEach((node) => {
        const previous = previousDlnaNodes.get(node.id)
        if (previous?.children) node.children = previous.children
      })
      const nonDlnaNodes = draft.nodes.filter(node => node.sourceKind !== "dlna")
      const firstBrowserIndex = nonDlnaNodes.findIndex(isBrowserRoot)
      if (firstBrowserIndex < 0) {
        draft.nodes = [...nonDlnaNodes, ...dlnaNodes]
        return
      }
      draft.nodes = [
        ...nonDlnaNodes.slice(0, firstBrowserIndex),
        ...dlnaNodes,
        ...nonDlnaNodes.slice(firstBrowserIndex),
      ]
    })
  }
  const setExpandedFolders = (update: ValueUpdate<Set<string>>) => setPlaylistState((draft) => {
    const current = new Set(Array.from(draft.expandedFolderIds))
    draft.expandedFolderIds = Array.from(resolveUpdate(current, update))
  })
  const setSelectedPlaylistId = (selectedId: string | undefined) => setPlaylistState((draft) => {
    draft.selectedId = selectedId
  })
  const [hasVideo, setHasVideo] = createSignal(false)
  const [playing, setPlaying] = createSignal(false)
  const [currentTime, setCurrentTime] = createSignal(0)
  const [duration, setDuration] = createSignal(0)
  const [volume, setVolume] = createSignal(initialPreferences.volume)
  const [playbackRate, setPlaybackRate] = createSignal(initialPreferences.playbackRate)
  const [repeatMode, setRepeatMode] = createSignal<RepeatMode>(initialPreferences.repeatMode)
  const [autoResumePlayback, setAutoResumePlayback] = createSignal(initialPreferences.autoResumePlayback)
  const [subtitleCues, setSubtitleCues] = createSignal<SubtitleCue[]>([])
  const [subtitlesEnabled, setSubtitlesEnabled] = createSignal(initialPreferences.subtitlesEnabled)
  const [subtitleFileName, setSubtitleFileName] = createSignal<string>()
  const [debugPanelOpen, setDebugPanelOpen] = createSignal(false)
  const [faceAutoCenterPaused, setFaceAutoCenterPaused] = createSignal(false)
  const [projectionBoundaryWarning, setProjectionBoundaryWarning] = createSignal<ProjectionBoundaryWarning>()
  const showProjectionBoundaryWarning = (warning: ProjectionBoundaryWarning) => {
    setProjectionBoundaryWarning(warning)
    if (projectionBoundaryWarningTimer !== undefined) window.clearTimeout(projectionBoundaryWarningTimer)
    projectionBoundaryWarningTimer = window.setTimeout(() => {
      projectionBoundaryWarningTimer = undefined
      setProjectionBoundaryWarning(undefined)
    }, 1600)
  }
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
    onManualViewChange: () => scene?.pauseFaceAutoCenter(),
    initialState: initialPreferences,
  })
  const {
    changeQualityBy,
    faceAutoCenter,
    projectionId,
    qualityId,
    renderFrameRateId,
    resumeFaceAutoCenterAfterViewChange,
    splitScreen,
    resetTransientView,
    restoreProjection,
    syncFullscreen,
  } = displayModule
  const {
    resetView,
    setProjectionId: setDisplayProjectionId,
    toggleFullscreen,
  } = displayModule.controller
  const abLoopController = createAbLoopController({
    getVideo: () => video,
    getScene: () => scene,
    getMount: () => vrMount,
    getDuration: duration,
    getFileName: fileName,
    getFrameRate: () => VIDEO_FRAME_RATE_OPTIONS[renderFrameRateId() - 1]?.value ?? 30,
    getVideoBitRate: () => EXPORT_VIDEO_BIT_RATES[qualityId()] ?? 4_000_000,
    getSubtitleText: time => activeSubtitleText(subtitleCues(), time),
    hasSubtitles: subtitlesEnabled,
    hasVideo,
    setCurrentTime,
  })
  const {
    loop: abLoop,
    exportState: abExport,
    clear: clearAbLoop,
    exportFormatSupported: abExportFormatSupported,
    exportLoop: exportAbLoop,
    hasLoop: hasAbLoop,
    replay: replayAbLoop,
    reset: resetAbLoop,
    setEnd: setAbEnd,
    setStart: setAbStart,
    syncPlaybackTime: syncAbLoopTime,
  } = abLoopController
  const controlsModule = createControls({ hasVideo, resourcesReady })
  const {
    activeSlider,
    controlsVisible,
    dispose: disposeControls,
    handlePlayerPointerMove,
    handlePlayerPointerDown,
    handlePlayerPointerUp,
    handleUiPointerDown,
    handleUiPointerUp,
    hideControls,
    registerActivity,
    registerUiSurface,
    resyncPointerHold,
    setControlsHold,
    showControls,
    toggleSlider,
    sliderAnchor,
    startInitialIdleCountdown,
  } = controlsModule
  const playlistVisible = createMemo(() => playlist().length > 0 && controlsVisible())
  const syncPointerHoldAfterLayout = () => {
    window.requestAnimationFrame(() => {
      resyncPointerHold()
    })
  }
  const handleFullscreenChange = () => {
    syncFullscreen()
    syncPointerHoldAfterLayout()
  }
  createEffect(
    () => playlistVisible(),
    (visible) => {
      if (visible) syncPointerHoldAfterLayout()
    },
  )
  let loadingPromise: Promise<void> | undefined
  let appDisposed = false

  const activePlaybackSnapshot = (nextProjectionId = projectionId()): LastPlayback | undefined => {
    const key = activeVideoKey
    if (!key) return
    return { key, position: video.currentTime || 0, projectionId: nextProjectionId }
  }

  const persistVideoHistory = async (playback: LastPlayback) => {
    try {
      await saveVideoPlaybackState({ ...playback, updatedAt: Date.now() })
    } catch (error) {
      console.warn("video playback state could not be saved", error)
    }
  }

  const writeLastPlayback = (playback: LastPlayback) => {
    lastPlayback = { key: playback.key, position: playback.position, projectionId: playback.projectionId }
    saveLastPlayback(lastPlayback)
    lastPlaybackSavedAt = Date.now()
  }

  const persistLastPlayback = (force = false, nextProjectionId = projectionId()) => {
    const now = Date.now()
    if (!force && now - lastPlaybackSavedAt < LAST_PLAYBACK_SAVE_INTERVAL_MS) return
    const playback = activePlaybackSnapshot(nextProjectionId)
    if (playback) writeLastPlayback(playback)
  }

  function scheduleActiveVideoStateSave(delay = VIDEO_STATE_SAVE_INTERVAL_MS) {
    if (!activeVideoKey || videoStateSaveTimer !== undefined) return
    videoStateSaveTimer = window.setTimeout(() => {
      videoStateSaveTimer = undefined
      const playback = activePlaybackSnapshot()
      if (playback) void persistVideoHistory(playback)
    }, delay)
  }

  const setProjectionId = (update: ValueUpdate<number>) => {
    const nextProjectionId = setDisplayProjectionId(update)
    persistLastPlayback(true, nextProjectionId)
    scheduleActiveVideoStateSave()
    return nextProjectionId
  }

  const persistActiveVideoState = () => {
    if (videoStateSaveTimer !== undefined) window.clearTimeout(videoStateSaveTimer)
    videoStateSaveTimer = undefined
    const playback = activePlaybackSnapshot()
    if (!playback) return
    writeLastPlayback(playback)
    void persistVideoHistory(playback)
  }

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
  const hasBrowserPlaylistItems = createMemo(() => playlist().some(
    node => node.sourceKind === "browser" || playlistFiles.has(node.id),
  ))

  const sceneOptions = () => ({
    projection: PROJECTION_OPTIONS[projectionId()].component,
    quality: QUALITY_OPTIONS[qualityId()].component,
    frameRate: VIDEO_FRAME_RATE_OPTIONS[renderFrameRateId() - 1]?.value ?? 30,
    hidden: false,
    splitScreen: splitScreen(),
    faceAutoCenter: faceAutoCenter(),
    resumeFaceAutoCenterAfterViewChange: resumeFaceAutoCenterAfterViewChange(),
    debugPanelOpen: debugPanelOpen(),
  })

  const showVideoTranslationLayer = () => {
    video.classList.remove("hidden")
    video.classList.add("block")
    video.classList.add("opacity-[0.01]", "pointer-events-none")
    video.dataset.displayMode = "vr-translation-layer"
  }

  const syncTime = () => {
    if (pendingResumeTime !== undefined && Number.isFinite(video.duration)) {
      const resumeTime = pendingResumeTime >= video.duration - 5 ? 0 : Math.min(pendingResumeTime, video.duration)
      pendingResumeTime = undefined
      video.currentTime = resumeTime
    }
    const time = video.currentTime || 0
    if (syncAbLoopTime(time)) return
    setCurrentTime(time)
    setDuration(video.duration || 0)
    persistLastPlayback()
    scheduleActiveVideoStateSave()
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

  const togglePlayAndHideControls = () => {
    if (!resourcesReady()) return
    suppressNextPauseActivity = Boolean(video.currentSrc && !video.paused)
    togglePlay()
    hideControls()
  }

  const seekBy = (amount: number) => {
    if (!resourcesReady()) return
    if (!Number.isFinite(video.duration)) return
    const nextTime = Math.min(video.duration, Math.max(0, video.currentTime + amount))
    video.currentTime = nextTime
  }

  const setVolumeLevel = (next: number) => {
    if (!resourcesReady()) return
    const clamped = Math.min(1, Math.max(0, next))
    video.volume = clamped
    video.muted = clamped === 0
    if (clamped > 0) lastAudibleVolume = clamped
    setVolume(clamped)
  }

  const setPlaybackRateLevel = (next: number) => {
    if (!Number.isFinite(next) || next <= 0) return
    video.playbackRate = next
    setPlaybackRate(next)
  }

  const toggleMute = () => {
    if (!resourcesReady()) return
    if (volume() === 0 || video.muted) {
      setVolumeLevel(lastAudibleVolume || 0.7)
    } else {
      setVolumeLevel(0)
    }
  }

  function openVideoFile() {
    if (!canImportLocalMedia()) return
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
    persistActiveVideoState()
    activeVideoKey = undefined
    pendingResumeTime = undefined
    scene?.resetMedia()
    await detachCurrentVideoSource()
    if (appDisposed || generation !== videoLoadGeneration || pendingVideoSwitch) return
    fileUrl = resource.file ? URL.createObjectURL(resource.file) : undefined
    setHasVideo(true)
    setPlaying(false)
    setCurrentTime(0)
    setDuration(0)
    const fsvrIdentity = resource.url && fsvrMediaIdentity(resource.url)
    const playbackKey = !fsvrIdentity || fsvrIdentity.sourceId === "local" ? videoStateKey(resource) : undefined
    activeVideoKey = playbackKey
    const resumePlayback = playbackKey && lastPlayback?.key === playbackKey ? lastPlayback : undefined
    if (playbackKey) writeLastPlayback(resumePlayback ?? { key: playbackKey, position: 0, projectionId: 0 })
    restoreProjection(resumePlayback?.projectionId ?? 0)
    resetTransientView()
    resetAbLoop()
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
    if (resumePlayback) {
      pendingResumeTime = resumePlayback.position
      if (Number.isFinite(video.duration)) syncTime()
      void persistVideoHistory(resumePlayback)
    } else if (playbackKey) {
      try {
        const savedState = await loadVideoPlaybackState(playbackKey)
        if (savedState && generation === videoLoadGeneration && !appDisposed) {
          restoreProjection(savedState.projectionId)
          pendingResumeTime = savedState.position
          writeLastPlayback(savedState)
          if (Number.isFinite(video.duration)) syncTime()
        }
      } catch (error) {
        console.warn("video playback state could not be loaded", error)
      }
    }
    if (generation !== videoLoadGeneration || appDisposed) return
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

  const clearPlaylistNodes = () => {
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

  const resetCurrentVideo = () => {
    persistActiveVideoState()
    videoLoadGeneration += 1
    activeVideoKey = undefined
    pendingResumeTime = undefined
    autoplayPending = false
    scene?.destroy()
    scene = undefined
    resourcesInitialized = false
    setResourcesReady(true)
    setLoadingProgress(100)
    setLoadingLabel("Ready")
    video.pause()
    video.removeAttribute("src")
    video.load()
    video.classList.add("hidden")
    video.classList.remove("block", "opacity-[0.01]", "pointer-events-none")
    delete video.dataset.displayMode
    if (fileUrl) URL.revokeObjectURL(fileUrl)
    fileUrl = undefined
    setHasVideo(false)
    setPlaying(false)
    setCurrentTime(0)
    setDuration(0)
    setFileName(undefined)
    setSubtitleCues([])
    setSubtitleFileName(undefined)
    resetAbLoop()
  }

  const clearPlaylist = () => {
    const browserRoots = playlist().filter(node => node.sourceKind === "browser" || playlistFiles.has(node.id))
    if (!browserRoots.length) return
    const removedIds = new Set<string>()
    const collectIds = (nodes: PlaylistStateNode[]) => nodes.forEach((node) => {
      removedIds.add(node.id)
      collectIds(node.children ?? [])
    })
    collectIds(browserRoots)

    const clearsCurrentVideo = playlistState.selectedId !== undefined && removedIds.has(playlistState.selectedId)
    if (videoSwitchTimer !== undefined && pendingVideoSwitch?.playlistId && removedIds.has(pendingVideoSwitch.playlistId)) {
      window.clearTimeout(videoSwitchTimer)
      videoSwitchTimer = undefined
      pendingVideoSwitch = undefined
      autoplayPending = false
    }
    playlistImportGeneration += 1
    removedIds.forEach((id) => {
      playlistFiles.delete(id)
      playlistUrls.delete(id)
      playlistRemoteFolders.delete(id)
      playlistSubtitles.delete(id)
      playlistSubtitleUrls.delete(id)
    })
    setPlaylistState((draft) => {
      draft.nodes = draft.nodes.filter(node => !removedIds.has(node.id))
      draft.expandedFolderIds = draft.expandedFolderIds.filter(id => !removedIds.has(id))
      if (draft.selectedId && removedIds.has(draft.selectedId)) draft.selectedId = undefined
    })
    if (clearsCurrentVideo) resetCurrentVideo()
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

  const importPlaylistNodes = async (nodes: PlaylistNode[], playback: PlaylistImportPlayback) => {
    if (!nodes.length) return
    const firstVideo = firstVideoNode(nodes)
    if (playback === "always" && !firstVideo?.file && !firstVideo?.mediaUrl) return
    const findLastPlayedVideo = (items: PlaylistNode[]): PlaylistNode | undefined => {
      for (const node of items) {
        if (node.kind === "video" && videoStateKey({ name: node.name, file: node.file, url: node.mediaUrl }) === lastPlayback?.key) return node
        const nested = findLastPlayedVideo(node.children ?? [])
        if (nested) return nested
      }
    }
    const preferredVideo = lastPlayback ? findLastPlayedVideo(nodes) : undefined
    const videoToLoad = preferredVideo ?? firstVideo
    const videoFolderIds = videoToLoad ? playlistFolderIds(nodes, videoToLoad.id) ?? [] : []

    appendPlaylist(nodes)
    setExpandedFolders((current) => {
      const next = new Set(current)
      nodes.forEach(node => node.kind === "folder" && node.remoteSourceId === undefined && next.add(node.id))
      videoFolderIds.forEach(id => next.add(id))
      return next
    })

    if (countPlaylistVideos(nodes) > 1) showControls()

    const shouldLoadImportedVideo = Boolean(preferredVideo) || (!playing() && (firstVideo?.file || firstVideo?.mediaUrl)
      && (playback === "always" || (playback === "when-empty" && !hasVideo())))
    if (shouldLoadImportedVideo && videoToLoad) {
      if (videoToLoad.file) loadVideoFile(videoToLoad.file, videoToLoad.id)
      else if (videoToLoad.mediaUrl) loadVideoUrl(videoToLoad.mediaUrl, videoToLoad.name, videoToLoad.id)
    }
  }

  const importPlaylistTransfer = async (dataTransfer: DataTransfer, playback: PlaylistImportPlayback) => {
    const importGeneration = playlistImportGeneration
    try {
      const nodes = await playlistNodesFromTransfer(dataTransfer)
      if (appDisposed || importGeneration !== playlistImportGeneration) return
      await importPlaylistNodes(nodes, playback)
    } catch (error) {
      console.warn("video import failed", error)
    }
  }

  const handleFile = () => {
    const files = Array.from(fileInput.files ?? [])
    fileInput.value = ""
    void importPlaylistNodes(buildPlaylistTree(files), "always")
  }

  const handleFolder = () => {
    const files = Array.from(folderInput.files ?? [])
    folderInput.value = ""
    void importPlaylistNodes(buildPlaylistTree(files), "when-empty")
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

  const playbackFolderVideos = createMemo(() => videosInPlaybackFolder(playlist(), selectedPlaylistId()))
  const canPlayNext = createMemo(() => playbackFolderVideos().length > 1)

  const playNext = () => {
    const videos = playbackFolderVideos()
    const currentIndex = videos.findIndex(node => node.id === selectedPlaylistId())
    if (currentIndex < 0) return
    const next = videos[currentIndex + 1] ?? videos[0]
    if (next) playPlaylistNode(next.id)
  }

  const handlePlaybackEnded = () => {
    if (repeatMode() === "file" || hasAbLoop()) {
      replayAbLoop()
      return
    }
    if (repeatMode() === "off") return
    playNext()
  }

  const handleVideoDrop = async (event: DragEvent) => {
    event.preventDefault()
    if (!canImportLocalMedia()) return
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
    clearPlaylistNodes()
    await importPlaylistNodes(nodes, "when-empty")
    setServerState((draft) => {
      draft.status = "connected"
      draft.error = undefined
      draft.dlnaDevices = dlnaDevices
    })
    const playback = lastPlayback
    const identity = playback && fsvrMediaIdentity(playback.key)
    const location = identity?.sourceId === "local" && localFsvrVideoLocation(identity.entryId)
    if (playback && identity && location && nodes.some(node => node.remoteSourceId === "local")) {
      await Promise.resolve()
      for (const folderId of location.folderIds) {
        if (appDisposed) return
        await loadRemoteFolder(folderId)
        setExpandedFolders(current => new Set(current).add(folderId))
        await Promise.resolve()
      }
      const mediaUrl = new URL(
        `/api/v1/media/${encodeURIComponent(identity.sourceId)}/${encodeURIComponent(identity.entryId)}`,
        serverState.endpoint,
      ).href
      lastPlayback = { ...playback, key: videoStateKey({ name: location.name, url: mediaUrl }) }
      if (autoResumePlayback()) loadVideoUrl(mediaUrl, location.name, `${identity.sourceId}:${identity.entryId}`)
    }
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
      clearPlaylistNodes()
      setServerState((draft) => {
        draft.status = "authentication-required"
        draft.error = message
      })
      throw error
    }
  }

  const connectServer = async () => {
    const endpoint = window.location.origin
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
      refreshDlnaPlaylist(nodes)
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

    let handled = true
    switch (event.key) {
      case " ":
        event.preventDefault()
        togglePlay()
        break
      case "ArrowLeft":
        event.preventDefault()
        seekBy(-seekAmount)
        break
      case "ArrowRight":
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
        scene?.adjustForward(-1)
        break
      case "]":
      case "=":
        scene?.adjustForward(1)
        break
      case ",":
        changeQualityBy(-1)
        break
      case ".":
        changeQualityBy(1)
        break
      default: {
        const projectionNumber = Number(event.key)
        if (Number.isInteger(projectionNumber) && projectionNumber >= 1 && projectionNumber <= PROJECTION_OPTIONS.length) {
          setProjectionId(projectionNumber - 1)
        } else {
          handled = false
        }
      }
    }
    if (handled) registerActivity("keyboard")
  }

  const startInitialLoad = () => {
    if (loadingPromise || resourcesInitialized) return loadingPromise
    const loadGeneration = videoLoadGeneration

    loadingPromise = (async () => {
      setResourcesReady(false)
      setLoadingError(undefined)
      try {
        setLoadingLabel("Starting VR player")
        setLoadingProgress(75)
        const { createVrScene } = await import("../vr/scene")
        if (appDisposed || loadGeneration !== videoLoadGeneration) return
        scene = createVrScene({
          root: vrRoot,
          mount: vrMount,
          sampleCanvas,
          hintElement: faceHint,
          fpsElement: fpsMeter,
          video,
          viewRef,
          onFaceAutoCenterPauseChange: setFaceAutoCenterPaused,
          onProjectionBoundaryWarning: showProjectionBoundaryWarning,
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
        setLoadingError("Couldn’t get the player ready")
        setLoadingLabel("Try again")
      }
    })().finally(() => {
      loadingPromise = undefined
    })
    return loadingPromise
  }

  onSettled(() => {
    window.addEventListener("keydown", handleKeydown)
    document.addEventListener("fullscreenchange", handleFullscreenChange)

    if (connectFsvr) void connectServer().catch(error => console.warn("fsvr connection failed", error))
    let localPlaylistRefreshTimer: number | undefined
    let localPlaylistRefreshInFlight = false
    const refreshLocalPlaylist = async () => {
      if (localPlaylistRefreshInFlight) return
      localPlaylistRefreshInFlight = true
      try {
        await refreshLoadedLocalFolders()
      } catch (error) {
        console.warn("local playlist refresh failed", error)
      } finally {
        localPlaylistRefreshInFlight = false
      }
    }
    const stopLocalPlaylistRefresh = () => {
      if (localPlaylistRefreshTimer === undefined) return
      window.clearInterval(localPlaylistRefreshTimer)
      localPlaylistRefreshTimer = undefined
    }
    const startLocalPlaylistRefresh = () => {
      if (localPlaylistRefreshTimer !== undefined || document.hidden) return
      localPlaylistRefreshTimer = window.setInterval(() => void refreshLocalPlaylist(), LOCAL_PLAYLIST_REFRESH_INTERVAL_MS)
    }
    const handleVisibilityChange = () => {
      if (document.hidden) {
        stopLocalPlaylistRefresh()
        persistActiveVideoState()
      } else {
        void refreshLocalPlaylist()
        startLocalPlaylistRefresh()
      }
    }
    const handlePageHide = () => persistActiveVideoState()
    document.addEventListener("visibilitychange", handleVisibilityChange)
    window.addEventListener("pagehide", handlePageHide)
    startLocalPlaylistRefresh()

    return () => {
      appDisposed = true
      window.removeEventListener("keydown", handleKeydown)
      document.removeEventListener("fullscreenchange", handleFullscreenChange)
      document.removeEventListener("visibilitychange", handleVisibilityChange)
      window.removeEventListener("pagehide", handlePageHide)
      stopLocalPlaylistRefresh()
      if (videoSwitchTimer !== undefined) window.clearTimeout(videoSwitchTimer)
      if (projectionBoundaryWarningTimer !== undefined) window.clearTimeout(projectionBoundaryWarningTimer)
      pendingVideoSwitch = undefined
      autoplayPending = false
      playlistImportGeneration += 1
      disposeControls()
      scene?.destroy()
      persistActiveVideoState()
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
    () => ({ hasVideo: hasVideo(), resourcesReady: resourcesReady() }),
    (state) => {
      setControlsHold("loading", state.hasVideo && !state.resourcesReady)
    },
  )

  createEffect(
    () => sceneOptions(),
    (options) => {
      scene?.update(options)
      showVideoTranslationLayer()
    },
  )

  createEffect(
    () => ({
      volume: volume(),
      playbackRate: playbackRate(),
      qualityId: qualityId(),
      renderFrameRateId: renderFrameRateId(),
      splitScreen: splitScreen(),
      faceAutoCenter: faceAutoCenter(),
      resumeFaceAutoCenterAfterViewChange: resumeFaceAutoCenterAfterViewChange(),
      autoResumePlayback: autoResumePlayback(),
      subtitlesEnabled: subtitlesEnabled(),
      repeatMode: repeatMode(),
    }),
    preferences => saveGlobalPreferences(preferences),
  )

  const handleVolumeChange = () => {
    const nextVolume = video.muted ? 0 : video.volume
    if (nextVolume > 0) lastAudibleVolume = nextVolume
    setVolume(nextVolume)
  }

  const handlePlaybackRateChange = () => setPlaybackRate(video.playbackRate)

  const handlePlayingChange = (isPlaying: boolean) => {
    setPlaying(isPlaying)
    if (isPlaying) {
      suppressNextPauseActivity = false
      syncTime()
    } else if (suppressNextPauseActivity) {
      suppressNextPauseActivity = false
    } else {
      registerActivity("playback")
    }
    if (!isPlaying) persistActiveVideoState()
  }

  const setVideoElement = (element: HTMLVideoElement) => {
    video = element
    video.volume = initialPreferences.volume
    video.muted = initialPreferences.volume === 0
    video.playbackRate = initialPreferences.playbackRate
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
      canImportLocalMedia,
      chooseFolder: () => {
        if (canImportLocalMedia()) folderInput.click()
      },
      getPlayer: () => player,
      faceAutoCenterPaused,
      handleFile,
      handleFolder,
      handlePlayerPointerMove,
      handlePlayerPointerDown,
      handlePlayerPointerUp,
      handleUiPointerDown,
      handleUiPointerUp,
      handleVideoDrop,
      hasVideo,
      openVideoFile,
      projectionBoundaryWarning,
      resumeFaceAutoCenter: () => scene?.resumeFaceAutoCenter(),
      setFileInput: (element: HTMLInputElement) => (fileInput = element),
      setFolderInput: (element: HTMLInputElement) => (folderInput = element),
      setPlayer: (element: HTMLElement) => (player = element),
      setVideo: setVideoElement,
      setVrMount: (element: HTMLDivElement) => (vrMount = element),
      setVrRoot: (element: HTMLElement) => (vrRoot = element),
    },
    playlist: {
      chooseFiles: openVideoFile,
      chooseFolder: () => {
        if (canImportLocalMedia()) folderInput.click()
      },
      clearPlaylist,
      expandedFolders,
      hasBrowserPlaylistItems,
      playPlaylistNode,
      playlistVideos,
      state: playlistState,
      togglePlaylistFolder,
      visible: playlistVisible,
    },
    playback: {
      currentTime,
      duration,
      fileName,
      handleVolumeChange,
      handlePlaybackRateChange,
      loadingPercent,
      loadingState,
      openVideoFile,
      abLoop,
      abExport,
      autoResumePlayback,
      clearAbLoop,
      abExportFormatSupported,
      exportAbLoop,
      handlePlaybackEnded,
      playing,
      playbackRate,
      canPlayNext,
      playNext,
      repeatMode,
      progress,
      seekBy,
      seekTo,
      handlePlayingChange,
      setPlaybackRateLevel,
      setRepeatMode,
      setAbEnd,
      setAbStart,
      setAutoResumePlayback,
      setVolumeLevel,
      startInitialLoad,
      syncTime,
      toggleMute,
      togglePlay,
      togglePlayAndHideControls,
      volume,
    },
    subtitles: {
      enabled: subtitlesEnabled,
      fileName: subtitleFileName,
      hasSubtitle: () => subtitleCues().length > 0,
      text: subtitleText,
      toggle: () => setSubtitlesEnabled(current => !current),
    },
    display: {
      ...displayModule.controller,
      setProjectionId,
    },
    controls: {
      activeSlider,
      closeSlider: controlsModule.closeSlider,
      controlsVisible,
      registerActivity,
      registerUiSurface,
      setControlsPanel: controlsModule.setControlsPanel,
      setControlsHold,
      toggleSlider,
      updateSliderAnchor: controlsModule.updateSliderAnchor,
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
      enabled: () => connectFsvr,
      scanDlna,
      state: serverState,
    },
  }
}

export type PlayerController = ReturnType<typeof createPlayerController>
