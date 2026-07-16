import { subtitleMatchScore } from "../subtitles/matching"

export interface PlaylistStateNode {
  id: string
  name: string
  kind: "folder" | "video"
  sourceKind?: PlaylistSourceKind
  hasSubtitle?: boolean
  children?: PlaylistStateNode[]
}

export const videosInPlaybackFolder = (nodes: PlaylistStateNode[], selectedId: string | undefined) => {
  if (!selectedId) return []
  let result: PlaylistStateNode[] = []
  const collectVideos = (items: PlaylistStateNode[]) => {
    const videos: PlaylistStateNode[] = []
    const visit = (children: PlaylistStateNode[]) => children.forEach((node) => {
      if (node.kind === "video") videos.push(node)
      else visit(node.children ?? [])
    })
    visit(items)
    return videos
  }
  const visit = (items: PlaylistStateNode[], folderChildren?: PlaylistStateNode[]): boolean => {
    for (const node of items) {
      if (node.id === selectedId && node.kind === "video") {
        result = collectVideos(folderChildren ?? items)
        return true
      }
      if (node.kind === "folder" && visit(node.children ?? [], node.children ?? [])) return true
    }
    return false
  }
  visit(nodes)
  return result
}

export type PlaylistSourceKind = "browser" | "local" | "dlna"

export const applyPlaylistSource = (nodes: PlaylistNode[], sourceKind: PlaylistSourceKind) => {
  nodes.forEach((node) => {
    if (node.kind !== "folder") return
    node.sourceKind = sourceKind
    applyPlaylistSource(node.children ?? [], sourceKind)
  })
  return nodes
}

export interface PlaylistNode {
  id: string
  name: string
  kind: "folder" | "video" | "subtitle"
  sourceKind?: PlaylistSourceKind
  file?: File
  mediaUrl?: string
  remotePath?: string
  remoteSourceId?: string
  subtitleFile?: File
  subtitleName?: string
  subtitleUrl?: string
  children?: PlaylistNode[]
}

interface DragFileEntry {
  isFile: true
  isDirectory: false
  name: string
  file: (success: (file: File) => void, error?: (error: DOMException) => void) => void
}
interface DragDirectoryReader {
  readEntries: (success: (entries: DragEntry[]) => void, error?: (error: DOMException) => void) => void
}
interface DragDirectoryEntry {
  isFile: false
  isDirectory: true
  name: string
  createReader: () => DragDirectoryReader
}
type DragEntry = DragFileEntry | DragDirectoryEntry

let playlistNodeSequence = 0
const createPlaylistId = () => `playlist-${playlistNodeSequence++}`

export const isAppleDoublePath = (path: string) => path
  .split(/[\\/]/)
  .some(part => part.startsWith("._"))

export const isVideoFile = (file: File) =>
  file.type.startsWith("video/") || /\.(?:mp4|m4v|mov|webm|mkv|avi|ogv|mpeg|mpg)$/i.test(file.name)

export const isSubtitleFile = (file: File) => /\.(?:srt|vtt|ass|ssa)$/i.test(file.name)

const matchSubtitles = (videos: PlaylistNode[], subtitles: File[]) => {
  const candidates = videos.flatMap(video => subtitles.map(subtitle => ({
    video,
    subtitle,
    score: subtitleMatchScore(video.name, subtitle.name),
  }))).sort((a, b) => b.score - a.score)
  const matchedVideos = new Set<string>()
  const matchedSubtitles = new Set<File>()
  for (const candidate of candidates) {
    if (matchedVideos.has(candidate.video.id) || matchedSubtitles.has(candidate.subtitle)) continue
    candidate.video.subtitleFile = candidate.subtitle
    matchedVideos.add(candidate.video.id)
    matchedSubtitles.add(candidate.subtitle)
  }
}

const sortPlaylistNodes = (nodes: PlaylistNode[]) =>
  nodes.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" })
  })

export const buildPlaylistTree = (files: File[]) => {
  const roots: PlaylistNode[] = []
  const subtitlesByFolder = new Map<string, File[]>()
  const videosByFolder = new Map<string, PlaylistNode[]>()

  for (const file of files.filter((candidate) => {
    const relativePath = candidate.webkitRelativePath || candidate.name
    return !isAppleDoublePath(relativePath) && (isVideoFile(candidate) || isSubtitleFile(candidate))
  })) {
    const relativePath = file.webkitRelativePath || file.name
    const parts = relativePath.split("/").filter(Boolean)
    const folderPath = parts.slice(0, -1).join("/")
    if (isSubtitleFile(file)) {
      subtitlesByFolder.set(folderPath, [...(subtitlesByFolder.get(folderPath) ?? []), file])
      continue
    }
    let level = roots

    for (const folderName of parts.slice(0, -1)) {
      let folder = level.find(node => node.kind === "folder" && node.name === folderName)
      if (!folder) {
        folder = { id: createPlaylistId(), name: folderName, kind: "folder", children: [] }
        level.push(folder)
      }
      level = folder.children!
    }

    const videoNode = { id: createPlaylistId(), name: parts.at(-1) ?? file.name, kind: "video" as const, file }
    level.push(videoNode)
    videosByFolder.set(folderPath, [...(videosByFolder.get(folderPath) ?? []), videoNode])
  }

  videosByFolder.forEach((videos, folder) => matchSubtitles(videos, subtitlesByFolder.get(folder) ?? []))

  const sortLevel = (nodes: PlaylistNode[]) => {
    sortPlaylistNodes(nodes)
    nodes.forEach(node => node.children && sortLevel(node.children))
  }
  sortLevel(roots)
  return applyPlaylistSource(roots, "browser")
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

async function playlistNodeFromEntry(entry: DragEntry): Promise<PlaylistNode | undefined> {
  if (isAppleDoublePath(entry.name)) return undefined

  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) => entry.file(resolve, reject))
    if (isVideoFile(file)) return { id: createPlaylistId(), name: file.name, kind: "video", file }
    if (isSubtitleFile(file)) return { id: createPlaylistId(), name: file.name, kind: "subtitle", file }
    return undefined
  }

  const rawChildren = await playlistNodesFromEntries(await readDragDirectory(entry))
  const subtitleNodes = rawChildren.filter(node => node.kind === "subtitle")
  const children = rawChildren.filter(node => node.kind !== "subtitle")
  matchSubtitles(children.filter(node => node.kind === "video"), subtitleNodes.map(node => node.file!))
  if (!children.length) return undefined
  sortPlaylistNodes(children)
  return { id: createPlaylistId(), name: entry.name, kind: "folder", children }
}

export const playlistNodesFromTransfer = async (dataTransfer: DataTransfer) => {
  const entries = Array.from(dataTransfer.items)
    .map(item => (item as unknown as { webkitGetAsEntry?: () => DragEntry | null }).webkitGetAsEntry?.())
    .filter((entry): entry is DragEntry => Boolean(entry))
  const imported = entries.length
    ? await playlistNodesFromEntries(entries)
    : buildPlaylistTree(Array.from(dataTransfer.files))
  const subtitleNodes = imported.filter(node => node.kind === "subtitle")
  const nodes = imported.filter(node => node.kind !== "subtitle")
  applyPlaylistSource(nodes, "browser")
  matchSubtitles(nodes.filter(node => node.kind === "video"), subtitleNodes.map(node => node.file!))
  sortPlaylistNodes(nodes)
  return nodes
}

export const firstVideoNode = (nodes: PlaylistNode[]): PlaylistNode | undefined => {
  for (const node of nodes) {
    if (node.kind === "video") return node
    const nestedVideo = firstVideoNode(node.children ?? [])
    if (nestedVideo) return nestedVideo
  }
  return undefined
}

export const playlistFolderIds = (
  nodes: PlaylistNode[],
  targetId: string,
  folderIds: string[] = [],
): string[] | undefined => {
  for (const node of nodes) {
    if (node.id === targetId) return folderIds
    if (node.kind !== "folder") continue
    const found = playlistFolderIds(node.children ?? [], targetId, [...folderIds, node.id])
    if (found) return found
  }
}

export const countPlaylistVideos = (nodes: PlaylistNode[]): number => nodes.reduce(
  (count, node) => count + (node.kind === "video" ? 1 : countPlaylistVideos(node.children ?? [])),
  0,
)

export const findPlaylistStateNode = (
  nodes: PlaylistStateNode[],
  id: string,
): PlaylistStateNode | undefined => {
  for (const node of nodes) {
    if (node.id === id) return node
    const nested = findPlaylistStateNode(node.children ?? [], id)
    if (nested) return nested
  }
}
