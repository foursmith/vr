import { Show, untrack } from 'solid-js'
import type { PlayerController } from '../../features/player/controller'
import { PlaylistPanel } from '../playlist/PlaylistPanel'
import { createMediaDropTip, MediaDropTip } from '../ui/MediaDropTip'
import { EmptyState } from './EmptyState'
import { PlayerControls } from './PlayerControls'
import { PlayerStage } from './PlayerStage'

export function Player(props: {
  controls: PlayerController['controls']
  debug: PlayerController['debug']
  display: PlayerController['display']
  frame: PlayerController['frame']
  playback: PlayerController['playback']
  playlist: PlayerController['playlist']
}) {
  const controls = untrack(() => props.controls)
  const debug = untrack(() => props.debug)
  const display = untrack(() => props.display)
  const frame = untrack(() => props.frame)
  const playback = untrack(() => props.playback)
  const playlist = untrack(() => props.playlist)
  const {
    chooseFolder, cursorVisible, frameDragActive, handleFile, handleFolder,
    handlePlayerMouseMove, handleVideoDrop, hasVideo, openVideoFile,
    setFileInput, setFolderInput, setFrameDragActive, setPlayer,
    setVideo, setVrMount, setVrRoot,
  } = frame
  const { handleVolumeChange, playNextPlaylistVideo, setPlaying, syncTime } = playback
  const { state: displayState } = display
  const dropTip = createMediaDropTip()
  return (
    <main
      ref={setPlayer}
      id="player"
      class={`relative h-dvh overflow-hidden bg-black text-white ${cursorVisible() ? '' : 'cursor-none'}`}
      onMouseMove={handlePlayerMouseMove}
      onDragEnter={(event) => {
        event.preventDefault()
        if (Array.from(event.dataTransfer?.types ?? []).includes('Files')) {
          dropTip.updatePosition(event)
          setFrameDragActive(true)
        }
      }}
      onDragOver={(event) => {
        event.preventDefault()
        dropTip.updatePosition(event)
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFrameDragActive(false)
      }}
      onDrop={(event) => void handleVideoDrop(event)}
    >
      <input ref={setFileInput} type="file" accept="video/*" multiple class="hidden" onChange={handleFile} />
      <input
        ref={setFolderInput}
        type="file"
        accept="video/*"
        multiple
        class="hidden"
        {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
        onChange={handleFolder}
      />
      <PlayerStage
        videoOnly={displayState.videoOnly}
        debug={debug}
        setVrRoot={setVrRoot}
        setVrMount={setVrMount}
        setVideo={setVideo}
        onTimeUpdate={syncTime}
        onPlaying={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={playNextPlaylistVideo}
        onVolumeChange={handleVolumeChange}
      />

      <Show when={!hasVideo()}>
        <EmptyState onChooseFiles={openVideoFile} onChooseFolder={() => chooseFolder()} />
      </Show>

      <Show when={frameDragActive()}>
        <MediaDropTip controller={dropTip} />
      </Show>

      <PlaylistPanel controller={playlist} />
      <PlayerControls
        controls={controls}
        debug={debug}
        display={display}
        playback={playback}
        playlist={playlist}
      />
    </main>
  )
}
