import { describe, expect, it } from "vitest"
import { buildPlaylistTree, firstVideoNode, isSubtitleFile, isVideoFile, playlistNodesFromTransfer, subtitleMatchScore } from "../../src/features/playlist/model"

const file = (name: string, type = "", relativePath?: string) => {
  const value = new File(["media"], name, { type })
  if (relativePath) Object.defineProperty(value, "webkitRelativePath", { value: relativePath })
  return value
}

describe("playlist model", () => {
  it("recognizes MIME types and supported extensions case-insensitively", () => {
    expect(isVideoFile(file("clip.bin", "video/mp4"))).toBe(true)
    expect(isVideoFile(file("clip.MKV"))).toBe(true)
    expect(isVideoFile(file("notes.txt", "text/plain"))).toBe(false)
    expect(isSubtitleFile(file("captions.ZH-CN.SRT"))).toBe(true)
  })

  it("matches subtitles by the highest relative filename similarity in each folder", () => {
    const tree = buildPlaylistTree([
      file("Episode 01.mp4", "video/mp4", "Show/Episode 01.mp4"),
      file("Episode 02.mp4", "video/mp4", "Show/Episode 02.mp4"),
      file("Episode.02.zh-CN.srt", "", "Show/Episode.02.zh-CN.srt"),
      file("Episode 01 English.vtt", "", "Show/Episode 01 English.vtt"),
      file("Episode 01.srt", "", "Other/Episode 01.srt"),
    ])
    const videos = tree[0].children ?? []
    expect(videos[0].subtitleFile?.name).toBe("Episode 01 English.vtt")
    expect(videos[1].subtitleFile?.name).toBe("Episode.02.zh-CN.srt")
    expect(subtitleMatchScore("Movie Director Cut.mkv", "Movie.Director.Cut.zh.srt")).toBeGreaterThan(0.9)
  })

  it("builds nested, folder-first, naturally sorted trees and ignores non-video files", () => {
    const tree = buildPlaylistTree([
      file("clip10.mp4", "video/mp4", "Holiday/clip10.mp4"),
      file("clip2.mp4", "video/mp4", "Holiday/clip2.mp4"),
      file("cover.jpg", "image/jpeg", "Holiday/cover.jpg"),
      file("root.webm", "video/webm"),
      file("nested.mov", "video/quicktime", "Archive/Deep/nested.mov"),
    ])

    expect(tree.map(({ name, kind }) => [name, kind])).toEqual([
      ["Archive", "folder"],
      ["Holiday", "folder"],
      ["root.webm", "video"],
    ])
    expect(tree[1].children?.map(node => node.name)).toEqual(["clip2.mp4", "clip10.mp4"])
    expect(tree[0].sourceKind).toBe("browser")
    expect(tree[0].children?.[0].sourceKind).toBe("browser")
    expect(firstVideoNode(tree)?.name).toBe("nested.mov")
  })

  it("ignores AppleDouble files and folders from browser imports", () => {
    const tree = buildPlaylistTree([
      file("movie.mp4", "video/mp4", "Movies/movie.mp4"),
      file("._movie.mp4", "video/mp4", "Movies/._movie.mp4"),
      file("hidden.mp4", "video/mp4", "._Metadata/hidden.mp4"),
    ])

    expect(tree).toHaveLength(1)
    expect(tree[0].children?.map(node => node.name)).toEqual(["movie.mp4"])
  })

  it("falls back to DataTransfer files when directory entries are unavailable", async () => {
    const files = [file("movie.mp4", "video/mp4"), file("readme.txt", "text/plain")]
    const transfer = { items: [{}, {}], files } as unknown as DataTransfer
    const nodes = await playlistNodesFromTransfer(transfer)
    expect(nodes.map(node => node.name)).toEqual(["movie.mp4"])
  })

  it("recursively reads directory entry batches and filters empty folders", async () => {
    const video = file("inside.webm", "video/webm")
    const fileEntry = { isFile: true, isDirectory: false, name: video.name, file: (resolve: (file: File) => void) => resolve(video) }
    let reads = 0
    const folderEntry = {
      isFile: false,
      isDirectory: true,
      name: "Folder",
      createReader: () => ({ readEntries: (resolve: (entries: unknown[]) => void) => resolve(reads++ === 0 ? [fileEntry] : []) }),
    }
    const transfer = { items: [{ webkitGetAsEntry: () => folderEntry }], files: [] } as unknown as DataTransfer
    const nodes = await playlistNodesFromTransfer(transfer)
    expect(nodes[0]).toMatchObject({ name: "Folder", kind: "folder", sourceKind: "browser" })
    expect(nodes[0].children?.[0]).toMatchObject({ name: "inside.webm", kind: "video", file: video })
  })

  it("ignores AppleDouble entries during drag and drop", async () => {
    const metadata = file("._inside.webm", "video/webm")
    const metadataEntry = { isFile: true, isDirectory: false, name: metadata.name, file: (resolve: (file: File) => void) => resolve(metadata) }
    const transfer = { items: [{ webkitGetAsEntry: () => metadataEntry }], files: [metadata] } as unknown as DataTransfer

    expect(await playlistNodesFromTransfer(transfer)).toEqual([])
  })
})
