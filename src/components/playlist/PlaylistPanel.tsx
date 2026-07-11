import { For, Show, untrack } from 'solid-js'
import type { PlayerController } from '../../features/player/controller'
import { PlaylistTreeNode } from '../playlist/PlaylistTreeNode'
import { Icon } from '../ui/Icon'
import { IconButton } from '../ui/IconButton'
import { LiquidGlass } from '../ui/LiquidGlass'
import { MediaPickerButtons } from '../ui/MediaPickerButtons'

export function PlaylistPanel(props: { controller: PlayerController['playlist'] }) {
  const {
    chooseFiles, chooseFolder, clearPlaylist, expandedFolders, playPlaylistNode, playlistVideos,
    setPlaylistOpen, state, togglePlaylistFolder, visible,
  } = untrack(() => props.controller)
  return (
      <div
        class={`pointer-events-auto absolute bottom-40 left-3 top-3 z-30 w-[min(15rem,calc(100vw-1.5rem))] transition-[transform,opacity] duration-300 ease-[cubic-bezier(.22,.8,.24,1)] sm:bottom-6 sm:left-6 sm:top-6 sm:w-72 ${
          visible() ? 'translate-x-0 opacity-100' : 'pointer-events-none -translate-x-[calc(100%+1.5rem)] opacity-0'
        }`}
        aria-hidden={visible() ? 'false' : 'true'}
        inert={!visible()}
      >
        <LiquidGlass
          class="h-full w-full rounded-[20px] text-white"
          cornerRadius={20}
          elasticity={0}
          castShadow
        >
          <aside
            class="flex h-full w-full flex-col overflow-hidden rounded-[20px] border border-white/12 text-white"
            aria-label="Playlist"
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
                  <div class="grid min-h-full w-full content-end justify-items-center gap-4 rounded-xl px-1 pb-2 text-center">
                    <img
                      src="/icon.svg"
                      alt="Face Cam VR"
                      class="h-16 w-16 drop-shadow-[0_12px_28px_rgba(0,0,0,0.45)]"
                    />
                    <div class="grid gap-1.5">
                      <span class="text-balance text-sm font-semibold text-white/92">Drop video files or folders here</span>
                      <span class="text-balance text-[11px] font-medium text-white/48">or choose what to add</span>
                    </div>
                    <MediaPickerButtons onChooseFiles={chooseFiles} onChooseFolder={chooseFolder} />
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

            <Show when={state.nodes.length}>
              <footer class="grid shrink-0 place-items-center border-t border-white/9 p-2">
                <MediaPickerButtons onChooseFiles={chooseFiles} onChooseFolder={chooseFolder} />
              </footer>
            </Show>
          </aside>
        </LiquidGlass>
      </div>
  )
}
