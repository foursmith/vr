import { describe, expect, it } from 'vitest'
import { buildPlaylistTree, firstVideoNode, isVideoFile, playlistNodesFromTransfer } from '../../src/features/playlist/model'

const file = (name: string, type = '', relativePath?: string) => {
  const value = new File(['media'], name, { type })
  if (relativePath) Object.defineProperty(value, 'webkitRelativePath', { value: relativePath })
  return value
}

describe('playlist model', () => {
  it('recognizes MIME types and supported extensions case-insensitively', () => {
    expect(isVideoFile(file('clip.bin', 'video/mp4'))).toBe(true)
    expect(isVideoFile(file('clip.MKV'))).toBe(true)
    expect(isVideoFile(file('notes.txt', 'text/plain'))).toBe(false)
  })

  it('builds nested, folder-first, naturally sorted trees and ignores non-video files', () => {
    const tree = buildPlaylistTree([
      file('clip10.mp4', 'video/mp4', 'Holiday/clip10.mp4'),
      file('clip2.mp4', 'video/mp4', 'Holiday/clip2.mp4'),
      file('cover.jpg', 'image/jpeg', 'Holiday/cover.jpg'),
      file('root.webm', 'video/webm'),
      file('nested.mov', 'video/quicktime', 'Archive/Deep/nested.mov'),
    ])

    expect(tree.map(({ name, kind }) => [name, kind])).toEqual([
      ['Archive', 'folder'], ['Holiday', 'folder'], ['root.webm', 'video'],
    ])
    expect(tree[1].children?.map((node) => node.name)).toEqual(['clip2.mp4', 'clip10.mp4'])
    expect(firstVideoNode(tree)?.name).toBe('nested.mov')
  })

  it('falls back to DataTransfer files when directory entries are unavailable', async () => {
    const files = [file('movie.mp4', 'video/mp4'), file('readme.txt', 'text/plain')]
    const transfer = { items: [{}, {}], files } as unknown as DataTransfer
    const nodes = await playlistNodesFromTransfer(transfer)
    expect(nodes.map((node) => node.name)).toEqual(['movie.mp4'])
  })

  it('recursively reads directory entry batches and filters empty folders', async () => {
    const video = file('inside.webm', 'video/webm')
    const fileEntry = { isFile: true, isDirectory: false, name: video.name, file: (resolve: (file: File) => void) => resolve(video) }
    let reads = 0
    const folderEntry = {
      isFile: false,
      isDirectory: true,
      name: 'Folder',
      createReader: () => ({ readEntries: (resolve: (entries: unknown[]) => void) => resolve(reads++ === 0 ? [fileEntry] : []) }),
    }
    const transfer = { items: [{ webkitGetAsEntry: () => folderEntry }], files: [] } as unknown as DataTransfer
    const nodes = await playlistNodesFromTransfer(transfer)
    expect(nodes[0]).toMatchObject({ name: 'Folder', kind: 'folder' })
    expect(nodes[0].children?.[0]).toMatchObject({ name: 'inside.webm', kind: 'video', file: video })
  })
})
