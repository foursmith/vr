import type { RepeatMode } from "../../features/player/playback-state"
import type { PlaylistStateNode } from "../../features/playlist/model"
import { createSignal, For, Show, untrack } from "solid-js"
import { PlaylistTreeNode } from "../playlist/PlaylistTreeNode"
import { IconButton } from "../ui/IconButton"
import { LiquidGlass } from "../ui/LiquidGlass"
import { MediaPickerButtons } from "../ui/MediaPickerButtons"

const REPEAT_MODES = [
  { value: "off", label: "Play once", icon: "play-once" },
  { value: "folder", label: "Repeat folder", icon: "folder-repeat" },
  { value: "file", label: "Repeat video", icon: "repeat-once" },
] as const

export interface PlaylistPanelController {
  controls: {
    registerUiSurface: (element: HTMLElement) => void
    setControlsHold: (reason: "focus", held: boolean) => void
  }
  playback: {
    repeatMode: () => RepeatMode
    setRepeatMode: (mode: RepeatMode) => void
  }
  server: {
    scanDlna: () => Promise<void>
    state: {
      status: string
      scanningDlna: boolean
      error?: string
    }
  }
  playlist: {
    chooseFiles: () => void
    chooseFolder: () => void
    clearPlaylist: () => void
    expandedFolders: () => Set<string>
    hasBrowserPlaylistItems: () => boolean
    playPlaylistNode: (id: string) => void
    state: {
      nodes: PlaylistStateNode[]
      selectedId?: string
    }
    togglePlaylistFolder: (id: string) => void
    visible: () => boolean
  }
}

export function PlaylistPanel(props: { controller: PlaylistPanelController }) {
  const controller = untrack(() => props.controller)
  const [playlistExpanded, setPlaylistExpanded] = createSignal(true)
  const { registerUiSurface, setControlsHold } = controller.controls
  const { repeatMode, setRepeatMode } = controller.playback
  const { scanDlna, state: serverState } = controller.server
  const {
    chooseFiles,
    chooseFolder,
    clearPlaylist,
    expandedFolders,
    hasBrowserPlaylistItems,
    playPlaylistNode,
    state,
    togglePlaylistFolder,
    visible,
  } = controller.playlist
  const currentRepeatMode = () => REPEAT_MODES.find(mode => mode.value === repeatMode()) ?? REPEAT_MODES[0]
  const cycleRepeatMode = () => {
    const currentIndex = REPEAT_MODES.findIndex(mode => mode.value === repeatMode())
    setRepeatMode(REPEAT_MODES[(currentIndex + 1) % REPEAT_MODES.length].value)
  }
  return (
    <div
      ref={registerUiSurface}
      class={`pointer-events-auto absolute left-1 top-1 z-30 max-h-[calc(100dvh-14.75rem)] transition-[transform,opacity] duration-300 ease-[cubic-bezier(.22,.8,.24,1)] sm:left-4 sm:top-4 sm:max-h-[calc(100dvh-13.5rem)] ${
        playlistExpanded() ? "w-[min(18rem,calc(100vw-1.5rem))] sm:w-72" : "h-12 w-12"
      } ${
        visible() ? "translate-x-0 opacity-100" : "pointer-events-none -translate-x-[calc(100%+1.5rem)] opacity-0"
      }`}
      aria-hidden={visible() ? "false" : "true"}
      inert={!visible()}
      onFocusIn={(event) => {
        setControlsHold("focus", (event.target as HTMLElement).matches(":focus-visible"))
      }}
      onFocusOut={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
        setControlsHold("focus", false)
      }}
    >
      <IconButton
        label={playlistExpanded() ? "Close playlist" : "Open playlist"}
        icon="playlist"
        iconClass="h-4 w-4"
        class={`!h-8 !w-8 ${playlistExpanded() ? "!absolute left-2 top-2 z-1" : "ml-2 mt-2"}`}
        pressed={playlistExpanded()}
        expanded={playlistExpanded()}
        controls="playlist-panel-content"
        onClick={() => setPlaylistExpanded(expanded => !expanded)}
      />
      <Show when={playlistExpanded()}>
        <LiquidGlass
          class="min-h-0 w-full rounded-[20px] text-white"
          cornerRadius={20}
          elasticity={0}
          castShadow
        >
          <aside
            id="playlist-panel-content"
            class="flex max-h-[calc(100dvh-14.75rem)] w-full flex-col overflow-hidden rounded-[20px] text-white sm:max-h-[calc(100dvh-13.5rem)]"
            aria-label="Playlist"
          >
            <header class="flex shrink-0 items-center gap-2 p-2 pl-12">
              <div class="min-w-0 flex-1 text-sm font-semibold tracking-tight text-white/94">Playlist</div>
              <IconButton
                label={`Playback mode: ${currentRepeatMode().label}`}
                icon={currentRepeatMode().icon}
                iconClass="h-4 w-4"
                class="!h-8 !w-8"
                onClick={cycleRepeatMode}
              />
              <Show when={serverState.status === "connected"}>
                <IconButton
                  label={serverState.scanningDlna ? "Scanning for DLNA devices" : "Scan for DLNA devices"}
                  icon="dlna-scan"
                  iconClass={`h-4 w-4 ${serverState.scanningDlna ? "animate-pulse" : ""}`}
                  class="!h-8 !w-8"
                  disabled={serverState.scanningDlna}
                  onClick={() => void scanDlna().catch(() => {})}
                />
              </Show>
              <IconButton
                label="Clear playlist"
                icon="trash"
                iconClass="h-3.5 w-3.5"
                class={`!h-8 !w-8 ${hasBrowserPlaylistItems() ? "" : "pointer-events-none opacity-25"}`}
                disabled={!hasBrowserPlaylistItems()}
                onClick={clearPlaylist}
              />
            </header>

            <Show when={serverState.error}>
              {message => <p role="alert" class="shrink-0 border-y border-white/7 px-4 py-2 text-[10px] text-red-300/85">{message()}</p>}
            </Show>

            <div class="playlist-scroll min-h-0 flex-1 overflow-y-auto px-2">
              <ul role="tree" aria-label="Video folders" class="m-0 list-none p-0">
                <For each={state.nodes}>
                  {node => (
                    <PlaylistTreeNode
                      node={node}
                      depth={0}
                      expanded={expandedFolders()}
                      selectedId={state.selectedId}
                      onToggle={togglePlaylistFolder}
                      onSelect={selected => playPlaylistNode(selected.id)}
                    />
                  )}
                </For>
              </ul>
            </div>

            <Show when={state.nodes.length}>
              <footer class="flex shrink-0 items-center justify-center p-2">
                <MediaPickerButtons fullWidth onChooseFiles={chooseFiles} onChooseFolder={chooseFolder} />
              </footer>
            </Show>
          </aside>
        </LiquidGlass>
      </Show>
    </div>
  )
}
