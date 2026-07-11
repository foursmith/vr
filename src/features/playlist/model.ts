export interface PlaylistStateNode {
  id: string
  name: string
  kind: "folder" | "video"
  hasSubtitle?: boolean
  children?: PlaylistStateNode[]
}

export interface PlaylistNode {
  id: string
  name: string
  kind: "folder" | "video" | "subtitle"
  file?: File
  subtitleFile?: File
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

export const isVideoFile = (file: File) =>
  file.type.startsWith("video/") || /\.(?:mp4|m4v|mov|webm|mkv|avi|ogv|mpeg|mpg)$/i.test(file.name)

export const isSubtitleFile = (file: File) => /\.(?:srt|vtt|ass|ssa)$/i.test(file.name)

const fileStem = (name: string) => name.replace(/\.[^.]+$/, "")

const normalizedName = (name: string) => fileStem(name)
  .normalize("NFKD")
  .toLocaleLowerCase()
  .replace(/\b(zh|zho|chi|chs|cht|cn|eng|en|english|简体|繁体|字幕|subtitle|sub)\b/g, " ")
  .replace(/[^\p{L}\p{N}]+/gu, " ")
  .trim()

const bigrams = (value: string) => {
  const compact = value.replace(/\s+/g, "")
  if (compact.length < 2) return new Set(compact ? [compact] : [])
  return new Set(Array.from({ length: compact.length - 1 }, (_, index) => compact.slice(index, index + 2)))
}

export const subtitleMatchScore = (videoName: string, subtitleName: string) => {
  const video = normalizedName(videoName)
  const subtitle = normalizedName(subtitleName)
  if (!video || !subtitle) return 0
  if (video === subtitle) return 1
  if (video.includes(subtitle) || subtitle.includes(video)) {
    return 0.82 + 0.18 * (Math.min(video.length, subtitle.length) / Math.max(video.length, subtitle.length))
  }
  const left = bigrams(video)
  const right = bigrams(subtitle)
  let overlap = 0
  left.forEach((part) => {
    if (right.has(part)) overlap += 1
  })
  return left.size + right.size ? (2 * overlap) / (left.size + right.size) : 0
}

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

  for (const file of files.filter(candidate => isVideoFile(candidate) || isSubtitleFile(candidate))) {
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

async function playlistNodeFromEntry(entry: DragEntry): Promise<PlaylistNode | undefined> {
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
