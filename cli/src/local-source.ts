import type { MediaEntry, MediaSource } from "./source"
import { Buffer } from "node:buffer"
import { lstat, readdir, realpath, stat } from "node:fs/promises"
import { basename, extname, isAbsolute, join, relative, resolve, sep } from "node:path"

const VIDEO_EXTENSIONS = new Set([".mp4", ".m4v", ".mov", ".webm", ".mkv", ".avi", ".ogv", ".mpeg", ".mpg"])
const SUBTITLE_EXTENSIONS = new Set([".srt", ".vtt", ".ass", ".ssa"])

const encodeId = (path: string) => Buffer.from(path).toString("base64url")
const decodeId = (id: string) => Buffer.from(id, "base64url").toString("utf8")

const entryKind = (name: string): MediaEntry["kind"] | undefined => {
  const extension = extname(name).toLowerCase()
  if (VIDEO_EXTENSIONS.has(extension)) return "video"
  if (SUBTITLE_EXTENSIONS.has(extension)) return "subtitle"
}

export async function createLocalSource(rootPath: string): Promise<MediaSource> {
  const root = await realpath(resolve(rootPath))

  const resolveInsideRoot = async (relativePath: string) => {
    if (isAbsolute(relativePath)) throw new Error("absolute paths are not allowed")
    const candidate = await realpath(resolve(root, relativePath || "."))
    const fromRoot = relative(root, candidate)
    if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
      throw new Error("path escapes the configured media root")
    }
    return candidate
  }

  return {
    id: "local",
    name: basename(root) || root,
    kind: "local",
    async list(path) {
      const relativeDirectory = path ? decodeId(path) : ""
      const directory = await resolveInsideRoot(relativeDirectory)
      const entries: MediaEntry[] = []
      for (const item of await readdir(directory)) {
        if ((await lstat(join(directory, item))).isSymbolicLink()) continue
        const fullPath = await resolveInsideRoot(join(relativeDirectory, item))
        const metadata = await stat(fullPath)
        const kind = metadata.isDirectory() ? "folder" : entryKind(item)
        if (!kind) continue
        const entryPath = relative(root, fullPath)
        entries.push({
          id: encodeId(entryPath),
          name: item,
          kind,
          size: metadata.isFile() ? metadata.size : undefined,
          modifiedAt: metadata.mtime.toISOString(),
        })
      }
      return entries.sort((left, right) => {
        if (left.kind !== right.kind) return left.kind === "folder" ? -1 : 1
        return left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" })
      })
    },
    resolve(id) {
      return resolveInsideRoot(decodeId(id)).then(path => ({ kind: "file" as const, path }))
    },
  }
}
