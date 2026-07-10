export type PlaylistNode = {
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

let playlistNodeSequence = 0
const createPlaylistId = () => `playlist-${playlistNodeSequence++}`

export const isVideoFile = (file: File) =>
  file.type.startsWith('video/') || /\.(mp4|m4v|mov|webm|mkv|avi|ogv|mpeg|mpg)$/i.test(file.name)

const sortPlaylistNodes = (nodes: PlaylistNode[]) =>
  nodes.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
  })

export const buildPlaylistTree = (files: File[]) => {
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

export const playlistNodesFromTransfer = async (dataTransfer: DataTransfer) => {
  const entries = Array.from(dataTransfer.items)
    .map((item) => (item as unknown as { webkitGetAsEntry?: () => DragEntry | null }).webkitGetAsEntry?.())
    .filter((entry): entry is DragEntry => Boolean(entry))
  const nodes = entries.length
    ? await playlistNodesFromEntries(entries)
    : buildPlaylistTree(Array.from(dataTransfer.files))
  sortPlaylistNodes(nodes)
  return nodes
}

export const firstVideoNode = (nodes: PlaylistNode[]): PlaylistNode | undefined => {
  for (const node of nodes) {
    if (node.kind === 'video') return node
    const nestedVideo = firstVideoNode(node.children ?? [])
    if (nestedVideo) return nestedVideo
  }
  return undefined
}
