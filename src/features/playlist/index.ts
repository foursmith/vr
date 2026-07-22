import type { ValueUpdate } from "../../lib/value-update"
import type { SubtitleResource } from "../subtitles"
import type { PlaylistNode, PlaylistStateNode } from "./model"
import { createMemo, createStore } from "solid-js"
import { resolveValueUpdate } from "../../lib/value-update"
import {
  applyPlaylistSource,
  buildPlaylistTree,
  countPlaylistVideos,
  findPlaylistStateNode,
  firstVideoNode,
  playlistFolderIds,
  playlistNodesFromTransfer,
  videosInPlaybackFolder,
} from "./model"

export type { PlaylistNode, PlaylistSourceKind, PlaylistStateNode } from "./model"
export { isAppleDoublePath, isVideoFile } from "./model"

interface PlaylistControllerOptions {
  cancelPendingVideoSwitch: (removedIds?: ReadonlySet<string>) => void
  canImportLocalMedia: () => boolean
  getFileInput: () => HTMLInputElement
  getFolderInput: () => HTMLInputElement
  getLastPlaybackKey: () => string | undefined
  getVideoPlaybackKey: (resource: { name: string, file?: File, url?: string }) => string
  isRemoteSourceConnected: () => boolean
  isDisposed: () => boolean
  isPlaying: () => boolean
  loadRemoteEntries: (sourceId: string, path: string) => Promise<PlaylistNode[]>
  loadVideoFile: (file: File, playlistId?: string) => void
  loadVideoUrl: (url: string, name: string, playlistId?: string) => void
  resetCurrentVideo: () => void
  showControls: () => void
}

export const createPlaylistController = (options: PlaylistControllerOptions) => {
  let importGeneration = 0
  const files = new Map<string, File>()
  const urls = new Map<string, string>()
  const remoteFolders = new Map<string, { path: string, sourceId: string }>()
  const subtitles = new Map<string, File>()
  const subtitleUrls = new Map<string, { name: string, url: string }>()
  const [state, setState] = createStore({
    nodes: [] as PlaylistStateNode[],
    expandedFolderIds: [] as string[],
    selectedId: undefined as string | undefined,
  })

  const nodes = () => state.nodes
  const selectedId = () => state.selectedId
  const expandedFolders = createMemo(() => new Set(state.expandedFolderIds))

  const serializeNodes = (items: PlaylistNode[]): PlaylistStateNode[] => items.map((node) => {
    if (node.file) files.set(node.id, node.file)
    if (node.mediaUrl) urls.set(node.id, node.mediaUrl)
    if (node.remoteSourceId !== undefined && node.remotePath !== undefined) {
      remoteFolders.set(node.id, { path: node.remotePath, sourceId: node.remoteSourceId })
    }
    if (node.subtitleFile) subtitles.set(node.id, node.subtitleFile)
    if (node.subtitleUrl) subtitleUrls.set(node.id, { name: node.subtitleName ?? "subtitle.srt", url: node.subtitleUrl })
    return {
      id: node.id,
      name: node.name,
      kind: node.kind === "folder" ? "folder" : "video",
      sourceKind: node.sourceKind,
      hasSubtitle: Boolean(node.subtitleFile || node.subtitleUrl),
      children: node.children ? serializeNodes(node.children) : undefined,
    }
  })

  const setExpandedFolders = (update: ValueUpdate<Set<string>>) => setState((draft) => {
    const current = new Set(Array.from(draft.expandedFolderIds))
    draft.expandedFolderIds = Array.from(resolveValueUpdate(current, update))
  })

  const setSelectedId = (id: string | undefined) => setState((draft) => {
    draft.selectedId = id
  })

  const append = (items: PlaylistNode[]) => setState((draft) => {
    draft.nodes.push(...serializeNodes(items))
  })

  const refreshDlna = (items: PlaylistNode[]) => {
    const dlnaNodes = serializeNodes(items.filter(node => node.sourceKind === "dlna"))
    setState((draft) => {
      const isBrowserRoot = (node: PlaylistStateNode) => node.sourceKind === "browser" || files.has(node.id)
      const previousDlnaNodes = new Map(
        draft.nodes.filter(node => node.sourceKind === "dlna").map(node => [node.id, node]),
      )
      dlnaNodes.forEach((node) => {
        const previous = previousDlnaNodes.get(node.id)
        if (previous?.children) node.children = previous.children
      })
      const nonDlnaNodes = draft.nodes.filter(node => node.sourceKind !== "dlna")
      const firstBrowserIndex = nonDlnaNodes.findIndex(isBrowserRoot)
      draft.nodes = firstBrowserIndex < 0
        ? [...nonDlnaNodes, ...dlnaNodes]
        : [
            ...nonDlnaNodes.slice(0, firstBrowserIndex),
            ...dlnaNodes,
            ...nonDlnaNodes.slice(firstBrowserIndex),
          ]
    })
  }

  const playlistVideos = createMemo(() => {
    const videos: PlaylistStateNode[] = []
    const visit = (items: PlaylistStateNode[]) => {
      items.forEach(node => (node.kind === "video" ? videos.push(node) : visit(node.children ?? [])))
    }
    visit(nodes())
    return videos
  })
  const hasBrowserItems = createMemo(() => nodes().some(
    node => node.sourceKind === "browser" || files.has(node.id),
  ))
  const playbackFolderVideos = createMemo(() => videosInPlaybackFolder(nodes(), selectedId()))
  const canPlayNext = createMemo(() => playbackFolderVideos().length > 1)

  const clearAll = () => {
    options.cancelPendingVideoSwitch()
    importGeneration += 1
    files.clear()
    urls.clear()
    remoteFolders.clear()
    subtitles.clear()
    subtitleUrls.clear()
    setState((draft) => {
      draft.nodes = []
      draft.expandedFolderIds = []
      draft.selectedId = undefined
    })
  }

  const clearBrowser = () => {
    const browserRoots = nodes().filter(node => node.sourceKind === "browser" || files.has(node.id))
    if (!browserRoots.length) return
    const removedIds = new Set<string>()
    const collectIds = (items: PlaylistStateNode[]) => items.forEach((node) => {
      removedIds.add(node.id)
      collectIds(node.children ?? [])
    })
    collectIds(browserRoots)

    const clearsCurrentVideo = state.selectedId !== undefined && removedIds.has(state.selectedId)
    options.cancelPendingVideoSwitch(removedIds)
    importGeneration += 1
    removedIds.forEach((id) => {
      files.delete(id)
      urls.delete(id)
      remoteFolders.delete(id)
      subtitles.delete(id)
      subtitleUrls.delete(id)
    })
    setState((draft) => {
      draft.nodes = draft.nodes.filter(node => !removedIds.has(node.id))
      draft.expandedFolderIds = draft.expandedFolderIds.filter(id => !removedIds.has(id))
      if (draft.selectedId && removedIds.has(draft.selectedId)) draft.selectedId = undefined
    })
    if (clearsCurrentVideo) options.resetCurrentVideo()
  }

  const playNode = (id: string) => {
    const file = files.get(id)
    if (file) {
      options.loadVideoFile(file, id)
      return
    }
    const url = urls.get(id)
    const node = playlistVideos().find(candidate => candidate.id === id)
    if (url && node) options.loadVideoUrl(url, node.name, id)
  }

  const importNodes = async (items: PlaylistNode[]) => {
    if (!items.length) return
    const firstVideo = firstVideoNode(items)
    const lastPlaybackKey = options.getLastPlaybackKey()
    const findLastPlayedVideo = (candidates: PlaylistNode[]): PlaylistNode | undefined => {
      for (const node of candidates) {
        if (node.kind === "video") {
          const playbackKey = options.getVideoPlaybackKey({ name: node.name, file: node.file, url: node.mediaUrl })
          if (playbackKey === lastPlaybackKey) return node
        }
        const nested = findLastPlayedVideo(node.children ?? [])
        if (nested) return nested
      }
    }
    const preferredVideo = lastPlaybackKey ? findLastPlayedVideo(items) : undefined
    const videoToLoad = preferredVideo ?? firstVideo
    const videoFolderIds = videoToLoad ? playlistFolderIds(items, videoToLoad.id) ?? [] : []

    append(items)
    setExpandedFolders((current) => {
      const next = new Set(current)
      items.forEach(node => node.kind === "folder" && node.remoteSourceId === undefined && next.add(node.id))
      videoFolderIds.forEach(id => next.add(id))
      return next
    })
    if (countPlaylistVideos(items) > 1) options.showControls()

    const shouldLoad = !options.isPlaying()
      && Boolean(videoToLoad?.file || videoToLoad?.mediaUrl)
    if (!shouldLoad || !videoToLoad) return
    if (videoToLoad.file) options.loadVideoFile(videoToLoad.file, videoToLoad.id)
    else if (videoToLoad.mediaUrl) options.loadVideoUrl(videoToLoad.mediaUrl, videoToLoad.name, videoToLoad.id)
  }

  const importTransfer = async (dataTransfer: DataTransfer) => {
    const generation = importGeneration
    try {
      const items = await playlistNodesFromTransfer(dataTransfer)
      if (options.isDisposed() || generation !== importGeneration) return
      await importNodes(items)
    } catch (error) {
      console.warn("video import failed", error)
    }
  }

  const handleFiles = () => {
    const input = options.getFileInput()
    const selectedFiles = Array.from(input.files ?? [])
    input.value = ""
    void importNodes(buildPlaylistTree(selectedFiles))
  }

  const handleFolder = () => {
    const input = options.getFolderInput()
    const selectedFiles = Array.from(input.files ?? [])
    input.value = ""
    void importNodes(buildPlaylistTree(selectedFiles))
  }

  const loadRemoteFolder = async (id: string) => {
    const remoteFolder = remoteFolders.get(id)
    if (!remoteFolder || !options.isRemoteSourceConnected()) return
    const loadedNodes = await options.loadRemoteEntries(remoteFolder.sourceId, remoteFolder.path)
    setState((draft) => {
      const visit = (items: PlaylistStateNode[]): boolean => {
        for (const item of items) {
          if (item.id === id) {
            if (item.sourceKind) applyPlaylistSource(loadedNodes, item.sourceKind)
            const previousChildren = item.children ?? []
            item.children = serializeNodes(loadedNodes).map((child) => {
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

  const toggleFolder = (id: string) => {
    const shouldLoad = remoteFolders.has(id) && !findPlaylistStateNode(nodes(), id)?.children
    setExpandedFolders((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    if (shouldLoad) void loadRemoteFolder(id).catch(error => console.warn("remote folder loading failed", error))
  }

  const refreshLoadedLocalFolders = async () => {
    if (!options.isRemoteSourceConnected()) return
    const loadedFolderIds: string[] = []
    const visit = (items: PlaylistStateNode[]) => {
      for (const node of items) {
        const remoteFolder = remoteFolders.get(node.id)
        if (node.kind === "folder" && node.children && remoteFolder?.sourceId === "local") loadedFolderIds.push(node.id)
        if (node.children) visit(node.children)
      }
    }
    visit(nodes())
    await Promise.all(loadedFolderIds.map(id => loadRemoteFolder(id)))
  }

  const playNext = () => {
    const videos = playbackFolderVideos()
    const currentIndex = videos.findIndex(node => node.id === selectedId())
    if (currentIndex < 0) return
    const next = videos[currentIndex + 1] ?? videos[0]
    if (next) playNode(next.id)
  }

  const handleDrop = async (event: DragEvent) => {
    event.preventDefault()
    if (!options.canImportLocalMedia()) return
    const dataTransfer = event.dataTransfer
    if (dataTransfer) await importTransfer(dataTransfer)
  }

  const getSubtitle = (id: string | undefined): SubtitleResource | undefined => {
    if (!id) return
    const file = subtitles.get(id)
    if (file) return { name: file.name, file }
    return subtitleUrls.get(id)
  }

  return {
    canPlayNext,
    clearAll,
    clearBrowser,
    dispose: () => (importGeneration += 1),
    expandedFolders,
    getSubtitle,
    handleDrop,
    handleFiles,
    handleFolder,
    hasBrowserItems,
    hasPlayableResource: (id: string) => files.has(id) || urls.has(id),
    importNodes,
    loadRemoteFolder,
    nodes,
    playNext,
    playNode,
    playlistVideos,
    refreshDlna,
    refreshLoadedLocalFolders,
    selectedId,
    setExpandedFolders,
    setSelectedId,
    state,
    toggleFolder,
  }
}
