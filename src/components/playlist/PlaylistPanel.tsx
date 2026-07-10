import { For, Show, untrack } from 'solid-js'
import type { PlayerController } from '../../features/player/controller'
import { PlaylistTreeNode } from '../playlist/PlaylistTreeNode'
import { Icon } from '../ui/Icon'
import { IconButton } from '../ui/IconButton'
import { LiquidGlass } from '../ui/LiquidGlass'

export function PlaylistPanel(props: { controller: PlayerController['playlist'] }) {
  const {
    chooseFolder, clearPlaylist, expandedFolders, handlePlaylistDrop, playPlaylistNode,
    playlistVideos, setPlaylistDragActive, setPlaylistOpen, state, togglePlaylistFolder,
  } = untrack(() => props.controller)
  return (
      <div
        class={`pointer-events-auto absolute bottom-40 left-3 top-3 z-30 w-[min(15rem,calc(100vw-1.5rem))] transition-[transform,opacity] duration-300 ease-[cubic-bezier(.22,.8,.24,1)] sm:bottom-6 sm:left-6 sm:top-6 sm:w-72 ${
          state.open ? 'translate-x-0 opacity-100' : 'pointer-events-none -translate-x-[calc(100%+1.5rem)] opacity-0'
        }`}
        aria-hidden={state.open ? 'false' : 'true'}
        inert={!state.open}
      >
        <LiquidGlass
          class={`h-full w-full rounded-[20px] text-white transition-shadow ${
            state.dragActive ? 'shadow-[0_0_0_3px_rgba(99,184,255,0.2)]' : ''
          }`}
          cornerRadius={20}
          displacementScale={46}
          blurAmount={0.06}
          saturation={150}
          aberrationIntensity={2.2}
          elasticity={0}
          active={state.dragActive}
          castShadow
        >
          <aside
            class="flex h-full w-full flex-col overflow-hidden rounded-[20px] border border-white/12 text-white"
            aria-label="Playlist"
            onDragEnter={(event) => {
              event.preventDefault()
              event.stopPropagation()
              setPlaylistDragActive(true)
            }}
            onDragOver={(event) => {
              event.preventDefault()
              event.stopPropagation()
              if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
            }}
            onDragLeave={(event) => {
              event.stopPropagation()
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setPlaylistDragActive(false)
            }}
            onDrop={(event) => void handlePlaylistDrop(event)}
          >
            <header class="flex h-14 shrink-0 items-center gap-2 border-b border-white/9 px-3">
              <span class="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/8 text-white/78 shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]">
                <Icon name="playlist" class="h-4.5 w-4.5" />
              </span>
              <div class="min-w-0 flex-1">
                <h2 class="text-sm font-semibold tracking-tight text-white/94">Playlist</h2>
                <p class="mt-0.5 text-[10px] text-white/42">
                  {playlistVideos().length} {playlistVideos().length === 1 ? 'video' : 'videos'}
                </p>
              </div>
              <IconButton
                label="Clear playlist"
                icon="trash"
                iconClass="h-3.5 w-3.5"
                class={`!h-8 !w-8 ${state.nodes.length ? '' : 'pointer-events-none opacity-25'}`}
                onClick={clearPlaylist}
              />
              <IconButton label="Close playlist" icon="x" iconClass="h-3.5 w-3.5" class="!h-8 !w-8" onClick={() => setPlaylistOpen(false)} />
            </header>

            <div class="playlist-scroll min-h-0 flex-1 overflow-y-auto px-2 py-2">
              <Show
                when={state.nodes.length}
                fallback={
                  <div
                    role="status"
                    class={`grid min-h-full w-full place-content-center justify-items-center gap-2 rounded-xl px-5 py-10 text-center transition ${
                      state.dragActive
                        ? 'bg-white/12 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.14)]'
                        : 'text-white/34'
                    }`}
                  >
                    <Icon name="folder" class="h-4.5 w-4.5" />
                    <span class="text-[11px] font-medium">{state.dragActive ? 'Release to add' : 'No videos'}</span>
                  </div>
                }
              >
                <ul role="tree" aria-label="Video folders" class="m-0 list-none p-0">
                  <For each={state.nodes}>
                    {(node) => (
                      <PlaylistTreeNode
                        node={node}
                        depth={0}
                        expanded={expandedFolders()}
                        selectedId={state.selectedId}
                        onToggle={togglePlaylistFolder}
                        onSelect={(selected) => playPlaylistNode(selected.id)}
                      />
                    )}
                  </For>
                </ul>
              </Show>
            </div>

            <footer class="shrink-0 border-t border-white/9 p-2">
              <LiquidGlass
                class="h-9 w-full rounded-full text-white"
                cornerRadius={999}
                displacementScale={32}
                blurAmount={0.052}
                saturation={150}
                aberrationIntensity={2.2}
                elasticity={0.12}
                castShadow={false}
              >
                <button
                  type="button"
                  class="flex h-full w-full cursor-pointer items-center justify-center gap-2 rounded-full border-0 bg-transparent px-3 text-xs font-semibold text-white/78 transition hover:text-white focus-visible:bg-white/10 focus-visible:outline-none"
                  onClick={() => chooseFolder()}
                >
                  <Icon name="plus" class="h-3.5 w-3.5" />
                  Add folder
                </button>
              </LiquidGlass>
            </footer>
          </aside>
        </LiquidGlass>
      </div>
  )
}
