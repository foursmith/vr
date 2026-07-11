import type { PlayerController } from "../../features/player/controller"
import { Show, untrack } from "solid-js"
import { PlaylistPanel } from "../playlist/PlaylistPanel"
import { createMediaDropTip, MediaDropTip } from "../ui/MediaDropTip"
import { EmptyState } from "./EmptyState"
import { PlayerControls } from "./PlayerControls"
import { PlayerStage } from "./PlayerStage"

export function Player(props: { controller: PlayerController }) {
  const controller = untrack(() => props.controller)
  const { frame, playlist } = controller
  const {
    chooseFolder,
    cursorVisible,
    frameDragActive,
    handleFile,
    handleFolder,
    handlePlayerMouseMove,
    handleVideoDrop,
    hasVideo,
    openVideoFile,
    setFileInput,
    setFolderInput,
    setFrameDragActive,
    setPlayer,
  } = frame
  const dropTip = createMediaDropTip()
  return (
    <main
      ref={setPlayer}
      id="player"
      class={`relative h-dvh overflow-hidden bg-black text-white ${cursorVisible() ? "" : "cursor-none"}`}
      onMouseMove={handlePlayerMouseMove}
      onDragEnter={(event) => {
        event.preventDefault()
        if (Array.from(event.dataTransfer?.types ?? []).includes("Files")) {
          dropTip.updatePosition(event)
          setFrameDragActive(true)
        }
      }}
      onDragOver={(event) => {
        event.preventDefault()
        dropTip.updatePosition(event)
        if (event.dataTransfer) event.dataTransfer.dropEffect = "copy"
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFrameDragActive(false)
      }}
      onDrop={event => void handleVideoDrop(event)}
    >
      <input ref={setFileInput} type="file" accept="video/*,.srt,.vtt,.ass,.ssa" multiple class="hidden" onChange={handleFile} />
      <input
        ref={setFolderInput}
        type="file"
        accept="video/*,.srt,.vtt,.ass,.ssa"
        multiple
        class="hidden"
        {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
        onChange={handleFolder}
      />
      <PlayerStage controller={controller} />

      <Show when={!hasVideo()}>
        <EmptyState onChooseFiles={openVideoFile} onChooseFolder={() => chooseFolder()} />
      </Show>

      <Show when={frameDragActive()}>
        <MediaDropTip controller={dropTip} />
      </Show>

      <PlaylistPanel controller={playlist} />
      <PlayerControls controller={controller} />
    </main>
  )
}
