import type { PlaylistNode, PlaylistSourceKind } from "../playlist"
import { isAppleDoublePath } from "../playlist"
import { subtitleMatchScore } from "../subtitles/matching"

interface ServerSource { id: string, name: string, kind: Exclude<PlaylistSourceKind, "browser"> }
export interface DlnaDevice { id: string, name: string, kind: string }
interface ServerEntry {
  id: string
  name: string
  kind: "folder" | "video" | "subtitle"
}

const requestJson = async <T>(url: URL): Promise<T> => {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`fsvr request failed (${response.status})`)
  return response.json() as Promise<T>
}

export async function authenticateFsvr(endpoint: string, password: string) {
  const response = await fetch(new URL("/api/v1/auth", endpoint), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password }),
  })
  if (!response.ok) throw new Error("Invalid password")
}

export async function hasFsvrAuth(endpoint: string) {
  const response = await fetch(new URL("/api/v1/auth", endpoint))
  if (!response.ok) return false
  return (await response.json() as { authenticated?: boolean }).authenticated === true
}

export async function detectFsvr(endpoint: string) {
  const response = await fetch(new URL("/api/v1/status", endpoint))
  if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) return false
  const status = await response.json() as { name?: string }
  return status.name === "fsvr"
}

export async function loadFsvrPlaylist(endpoint: string): Promise<PlaylistNode[]> {
  const baseUrl = new URL(endpoint)
  const sources = await requestJson<ServerSource[]>(new URL("/api/v1/sources", baseUrl))
  return sources.map(source => ({
    id: `source:${source.id}`,
    name: source.name,
    kind: "folder" as const,
    sourceKind: source.kind,
    remotePath: "",
    remoteSourceId: source.id,
  }))
}

export async function loadFsvrDlnaDevices(endpoint: string): Promise<DlnaDevice[]> {
  const sources = await requestJson<ServerSource[]>(new URL("/api/v1/sources", new URL(endpoint)))
  return sources.filter(source => source.kind === "dlna")
}

export async function loadFsvrEntries(endpoint: string, sourceId: string, parentId = ""): Promise<PlaylistNode[]> {
  const baseUrl = new URL(endpoint)
  const url = new URL(`/api/v1/sources/${encodeURIComponent(sourceId)}/entries`, baseUrl)
  if (parentId) url.searchParams.set("path", parentId)
  const entries = (await requestJson<ServerEntry[]>(url)).filter(entry => !isAppleDoublePath(entry.name))
  const mediaUrlFor = (entry: ServerEntry) => {
    const mediaUrl = new URL(`/api/v1/media/${encodeURIComponent(sourceId)}/${encodeURIComponent(entry.id)}`, baseUrl)
    return mediaUrl.href
  }
  const nodes = entries.filter(entry => entry.kind !== "subtitle").map((entry): PlaylistNode => {
    if (entry.kind === "folder") {
      return {
        id: `${sourceId}:${entry.id}`,
        name: entry.name,
        kind: "folder",
        remotePath: entry.id,
        remoteSourceId: sourceId,
      }
    }
    return { id: `${sourceId}:${entry.id}`, name: entry.name, kind: "video", mediaUrl: mediaUrlFor(entry) }
  })
  const videos = nodes.filter(node => node.kind === "video")
  const subtitles = entries.filter(entry => entry.kind === "subtitle")
  const candidates = videos.flatMap(video => subtitles.map(subtitle => ({
    score: subtitleMatchScore(video.name, subtitle.name),
    subtitle,
    video,
  }))).sort((left, right) => right.score - left.score)
  const matchedVideos = new Set<string>()
  const matchedSubtitles = new Set<string>()
  for (const candidate of candidates) {
    if (matchedVideos.has(candidate.video.id) || matchedSubtitles.has(candidate.subtitle.id)) continue
    candidate.video.subtitleUrl = mediaUrlFor(candidate.subtitle)
    candidate.video.subtitleName = candidate.subtitle.name
    matchedVideos.add(candidate.video.id)
    matchedSubtitles.add(candidate.subtitle.id)
  }
  return nodes
}

export async function discoverFsvrDlna(endpoint: string): Promise<DlnaDevice[]> {
  const url = new URL("/api/v1/dlna/discover", new URL(endpoint))
  const response = await fetch(url, {
    method: "POST",
  })
  if (!response.ok) throw new Error(`DLNA scan failed (${response.status})`)
  return response.json() as Promise<DlnaDevice[]>
}
