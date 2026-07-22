import type { ValueUpdate } from "../../../lib/value-update"
import { createEffect, createMemo } from "solid-js"
import { createServerController, isFsvrHostMode, loadFsvrEntries } from "../../fsvr"
import { createPlaylistController } from "../../playlist"
import { buildPlaylistTree } from "../../playlist/model"
import { createSubtitles } from "../../subtitles"
import { PROJECTION_OPTIONS, QUALITY_OPTIONS } from "../../vr/config"
import { createAbLoopController } from "../ab-loop"
import { createControls } from "../controls"
import { createDisplay } from "../display"
import { loadGlobalPreferences, saveGlobalPreferences, videoStateKey } from "../playback-state"
import { createPlayerKeyboardHandler } from "./keyboard"
import { setupPlayerLifecycle } from "./lifecycle"
import { createMediaController } from "./media"
import { createPlaybackController } from "./playback"
import { createPlaybackHistory } from "./playback-history"
import { createPlayerScene } from "./scene"

export const VIDEO_FRAME_RATE_OPTIONS = [
  { label: "24 fps", value: 24 },
  { label: "30 fps", value: 30 },
  { label: "60 fps", value: 60 },
] as const
const EXPORT_VIDEO_BIT_RATES = [2_000_000, 4_000_000, 8_000_000, 12_000_000] as const

export function createPlayerController(options: { connectFsvr?: boolean } = {}) {
  const connectFsvr = options.connectFsvr ?? isFsvrHostMode
  const initialPreferences = loadGlobalPreferences()
  let player!: HTMLElement
  let fileInput!: HTMLInputElement
  let folderInput!: HTMLInputElement
  let appDisposed = false

  let mediaModule!: ReturnType<typeof createMediaController>
  let serverModule!: ReturnType<typeof createServerController>
  let playlistModule!: ReturnType<typeof createPlaylistController>
  const canImportLocalMedia = () => !connectFsvr || serverModule.state.status === "connected"
  const sceneModule = createPlayerScene({
    getConfiguration: sceneOptions,
    getLoadGeneration: () => mediaModule.getGeneration(),
    getVideo: () => mediaModule.getVideo(),
    isCurrentLoad: generation => generation === mediaModule.getGeneration() && !appDisposed,
    onReady: handleSceneReady,
  })
  const resourcesReady = sceneModule.resourcesReady
  const playbackModule = createPlaybackController({
    getVideo: () => mediaModule.getVideo(),
    hideControls: hidePlaybackControls,
    initialPreferences,
    openVideoFile: () => openVideoFile(),
    persistActiveVideo,
    registerPlaybackActivity,
    resourcesReady,
    syncTime: () => mediaModule.syncTime(),
  })
  const {
    autoResumePlayback,
    currentTime,
    duration,
    fileName,
    handlePlayingChange,
    handleVolumeChange,
    hasVideo,
    playbackRate,
    playing,
    progress,
    repeatMode,
    seekBy,
    seekTo,
    setAutoResumePlayback,
    setCurrentTime,
    setDuration,
    setFileName,
    setHasVideo,
    setPlaybackRate: handlePlaybackRateChange,
    setPlaybackRateLevel,
    setPlaying,
    setRepeatMode,
    setVideoElement: initializeVideoElement,
    setVolumeLevel,
    toggleMute,
    togglePlay,
    togglePlayAndHideControls,
    volume,
  } = playbackModule
  const subtitlesModule = createSubtitles({
    getCurrentTime: currentTime,
    initialEnabled: initialPreferences.subtitlesEnabled,
    isCurrentLoad: generation => generation === mediaModule.getGeneration() && !appDisposed,
  })
  const displayModule = createDisplay({
    getPlayer: () => player,
    resourcesReady,
    viewRef: sceneModule.viewRef,
    onManualViewChange: sceneModule.pauseFaceAutoCenter,
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
  const playbackHistory = createPlaybackHistory({
    getProjectionId: projectionId,
    getVideo: () => mediaModule.getVideo(),
  })
  const abLoopController = createAbLoopController({
    getVideo: () => mediaModule.getVideo(),
    getScene: sceneModule.getScene,
    getMount: sceneModule.getMount,
    getDuration: duration,
    getFileName: fileName,
    getFrameRate: () => VIDEO_FRAME_RATE_OPTIONS[renderFrameRateId() - 1]?.value ?? 30,
    getVideoBitRate: () => EXPORT_VIDEO_BIT_RATES[qualityId()] ?? 4_000_000,
    getSubtitleText: subtitlesModule.getTextAt,
    hasSubtitles: subtitlesModule.enabled,
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
  function handleSceneReady() {
    if (!hasVideo()) return
    if (mediaModule.isAutoplayPending()) mediaModule.requestPlayback()
    startInitialIdleCountdown()
  }
  function hidePlaybackControls() {
    hideControls()
  }
  function persistActiveVideo() {
    void playbackHistory.persistActive()
  }
  function registerPlaybackActivity() {
    registerActivity("playback")
  }
  mediaModule = createMediaController({
    clearMediaFrame: sceneModule.clearMediaFrame,
    clearSubtitles: subtitlesModule.clear,
    getPlaylistSubtitle: id => playlistModule.getSubtitle(id),
    hasPlaylistResource: id => playlistModule.hasPlayableResource(id),
    initializeVideo: initializeVideoElement,
    isDisposed: () => appDisposed,
    loadSubtitle: (resource, generation) => void subtitlesModule.load(resource, generation),
    playbackHistory,
    resetAbLoop,
    resetPlayback: playbackModule.resetMedia,
    resetScene: sceneModule.reset,
    resetSceneMedia: sceneModule.resetMedia,
    resetTransientView,
    restoreProjection,
    setCurrentTime,
    setDuration,
    setFileName,
    setHasVideo,
    setPlaying,
    setSelectedPlaylistId: id => playlistModule.setSelectedId(id),
    startInitialIdleCountdown,
    syncAbLoopTime,
  })
  playlistModule = createPlaylistController({
    cancelPendingVideoSwitch: mediaModule.cancelPendingSwitch,
    canImportLocalMedia,
    getFileInput: () => fileInput,
    getFolderInput: () => folderInput,
    getLastPlaybackKey: playbackHistory.getLastKey,
    getVideoPlaybackKey: videoStateKey,
    isRemoteSourceConnected: () => serverModule.state.status === "connected",
    isDisposed: () => appDisposed,
    isPlaying: playing,
    loadRemoteEntries: (sourceId, path) => loadFsvrEntries(serverModule.state.endpoint, sourceId, path),
    loadVideoFile: mediaModule.loadFile,
    loadVideoUrl: mediaModule.loadUrl,
    resetCurrentVideo: mediaModule.reset,
    showControls,
  })
  const playlistVisible = createMemo(() => playlistModule.nodes().length > 0 && controlsVisible())
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
  const setProjectionId = (update: ValueUpdate<number>) => {
    const nextProjectionId = setDisplayProjectionId(update)
    playbackHistory.persistLast(true, nextProjectionId)
    playbackHistory.scheduleSave()
    return nextProjectionId
  }

  const loadingPercent = sceneModule.loadingPercent
  function sceneOptions() {
    return {
      projection: PROJECTION_OPTIONS[projectionId()].component,
      quality: QUALITY_OPTIONS[qualityId()].component,
      frameRate: VIDEO_FRAME_RATE_OPTIONS[renderFrameRateId() - 1]?.value ?? 30,
      hidden: false,
      splitScreen: splitScreen(),
      faceAutoCenter: faceAutoCenter(),
      resumeFaceAutoCenterAfterViewChange: resumeFaceAutoCenterAfterViewChange(),
      debugPanelOpen: sceneModule.debugPanelOpen(),
    }
  }

  function openVideoFile() {
    if (!canImportLocalMedia()) return
    fileInput.click()
  }

  const handlePlaybackEnded = () => {
    if (repeatMode() === "file" || hasAbLoop()) {
      replayAbLoop()
      return
    }
    if (repeatMode() === "off") return
    playlistModule.playNext()
  }

  serverModule = createServerController({
    autoResumePlayback,
    clearPlaylist: playlistModule.clearAll,
    enabled: connectFsvr,
    getLastPlaybackKey: playbackHistory.getLastKey,
    getVideoPlaybackKey: videoStateKey,
    importPlaylist: playlistModule.importNodes,
    isDisposed: () => appDisposed,
    loadRemoteFolder: playlistModule.loadRemoteFolder,
    loadVideoUrl: mediaModule.loadUrl,
    refreshDlnaPlaylist: playlistModule.refreshDlna,
    remapLastPlaybackKey: playbackHistory.remapLastKey,
    setFolderExpanded: id => playlistModule.setExpandedFolders(current => new Set(current).add(id)),
  })

  const handleKeydown = createPlayerKeyboardHandler({
    adjustForward: amount => sceneModule.getScene()?.adjustForward(amount),
    changeQualityBy,
    getVolume: volume,
    isReady: resourcesReady,
    projectionCount: PROJECTION_OPTIONS.length,
    registerActivity: () => registerActivity("keyboard"),
    resetView,
    seekBy,
    setProjectionId,
    setVolume: setVolumeLevel,
    toggleFullscreen: () => void toggleFullscreen(),
    toggleMute,
    togglePlay,
  })

  setupPlayerLifecycle({
    connectServer: connectFsvr ? serverModule.connect : undefined,
    dispose: () => {
      appDisposed = true
      playlistModule.dispose()
      disposeControls()
      sceneModule.destroy()
      mediaModule.dispose()
    },
    handleFullscreenChange,
    handleKeydown,
    importLaunchedFiles: async (files) => {
      if (!canImportLocalMedia()) return
      await playlistModule.importNodes(buildPlaylistTree(files))
    },
    persistActiveVideo: playbackHistory.persistActive,
    refreshLocalPlaylist: playlistModule.refreshLoadedLocalFolders,
  })

  createEffect(
    () => hasVideo(),
    (videoSelected) => {
      if (videoSelected) sceneModule.start()
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
      sceneModule.update(options)
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
      subtitlesEnabled: subtitlesModule.enabled(),
      repeatMode: repeatMode(),
    }),
    preferences => saveGlobalPreferences(preferences),
  )

  return {
    frame: {
      canImportLocalMedia,
      chooseFolder: () => {
        if (canImportLocalMedia()) folderInput.click()
      },
      getPlayer: () => player,
      faceAutoCenterPaused: sceneModule.faceAutoCenterPaused,
      handleFile: playlistModule.handleFiles,
      handleFolder: playlistModule.handleFolder,
      handlePlayerPointerMove,
      handlePlayerPointerDown,
      handlePlayerPointerUp,
      handleUiPointerDown,
      handleUiPointerUp,
      handleVideoDrop: playlistModule.handleDrop,
      hasVideo,
      openVideoFile,
      projectionBoundaryWarning: sceneModule.projectionBoundaryWarning,
      resumeFaceAutoCenter: sceneModule.resumeFaceAutoCenter,
      setFileInput: (element: HTMLInputElement) => (fileInput = element),
      setFolderInput: (element: HTMLInputElement) => (folderInput = element),
      setPlayer: (element: HTMLElement) => (player = element),
      setVideo: mediaModule.setVideo,
      setVrMount: sceneModule.setMount,
      setVrRoot: sceneModule.setRoot,
    },
    playlist: {
      chooseFiles: openVideoFile,
      chooseFolder: () => {
        if (canImportLocalMedia()) folderInput.click()
      },
      clearPlaylist: playlistModule.clearBrowser,
      expandedFolders: playlistModule.expandedFolders,
      hasBrowserPlaylistItems: playlistModule.hasBrowserItems,
      playPlaylistNode: playlistModule.playNode,
      playlistVideos: playlistModule.playlistVideos,
      state: playlistModule.state,
      togglePlaylistFolder: playlistModule.toggleFolder,
      visible: playlistVisible,
    },
    playback: {
      currentTime,
      duration,
      fileName,
      handleVolumeChange,
      handlePlaybackRateChange,
      loadingPercent,
      loadingState: sceneModule.loadingState,
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
      canPlayNext: playlistModule.canPlayNext,
      playNext: playlistModule.playNext,
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
      startInitialLoad: sceneModule.start,
      syncTime: mediaModule.syncTime,
      toggleMute,
      togglePlay,
      togglePlayAndHideControls,
      volume,
    },
    subtitles: {
      enabled: subtitlesModule.enabled,
      fileName: subtitlesModule.fileName,
      hasSubtitle: subtitlesModule.hasSubtitle,
      text: subtitlesModule.text,
      toggle: subtitlesModule.toggle,
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
      panelOpen: sceneModule.debugPanelOpen,
      setFaceHint: sceneModule.setFaceHint,
      setFpsMeter: sceneModule.setFpsMeter,
      setPanelOpen: sceneModule.setDebugPanelOpen,
      setSampleCanvas: sceneModule.setSampleCanvas,
    },
    server: {
      authenticate: serverModule.authenticate,
      enabled: serverModule.enabled,
      scanDlna: serverModule.scanDlna,
      state: serverModule.state,
    },
  }
}

export type PlayerController = ReturnType<typeof createPlayerController>
