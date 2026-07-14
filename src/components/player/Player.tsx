import type { PlayerController } from "../../features/player/controller"
import { Show, untrack } from "solid-js"
import { PlaylistPanel } from "../playlist/PlaylistPanel"
import { EmptyState } from "./EmptyState"
import { PlayerControls } from "./PlayerControls"
import { PlayerStage } from "./PlayerStage"

export function Player(props: { controller: PlayerController }) {
  const controller = untrack(() => props.controller)
  const { controls, frame, server } = controller
  const {
    canImportLocalMedia,
    chooseFolder,
    handleFile,
    handleFolder,
    handlePlayerPointerMove,
    handleUiPointerDown,
    handleUiPointerUp,
    handleVideoDrop,
    hasVideo,
    openVideoFile,
    setFileInput,
    setFolderInput,
    setPlayer,
  } = frame
  return (
    <main
      ref={setPlayer}
      id="player"
      class={`relative h-dvh overflow-hidden bg-black text-white ${controls.controlsVisible() ? "" : "cursor-none"}`}
      onPointerDown={handleUiPointerDown}
      onPointerMove={handlePlayerPointerMove}
      onPointerUp={handleUiPointerUp}
      onPointerCancel={handleUiPointerUp}
      onDragEnter={(event) => {
        if (!Array.from(event.dataTransfer?.types ?? []).includes("Files")) return
        event.preventDefault()
        if (event.dataTransfer) event.dataTransfer.dropEffect = canImportLocalMedia() ? "copy" : "none"
      }}
      onDragOver={(event) => {
        event.preventDefault()
        if (event.dataTransfer) event.dataTransfer.dropEffect = canImportLocalMedia() ? "copy" : "none"
      }}
      onDrop={(event) => {
        event.preventDefault()
        if (canImportLocalMedia()) void handleVideoDrop(event)
      }}
    >
      <input ref={setFileInput} type="file" accept="video/*,.srt,.vtt,.ass,.ssa" multiple disabled={!canImportLocalMedia()} class="hidden" onChange={handleFile} />
      <input
        ref={setFolderInput}
        type="file"
        multiple
        webkitdirectory=""
        disabled={!canImportLocalMedia()}
        class="hidden"
        onChange={handleFolder}
      />
      <PlayerStage controller={controller} />

      <Show when={!hasVideo()}>
        <EmptyState
          serverStatus={server.state.status}
          serverError={server.state.error}
          onAuthenticate={server.authenticate}
          onChooseFiles={openVideoFile}
          onChooseFolder={() => chooseFolder()}
        />
      </Show>

      <PlaylistPanel controller={controller} />
      <Show when={hasVideo()}>
        <PlayerControls controller={controller} />
      </Show>
    </main>
  )
}
