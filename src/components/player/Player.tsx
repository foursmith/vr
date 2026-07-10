import { Show, untrack } from 'solid-js'
import type { PlayerController } from '../../features/player/controller'
import { DebugPanel } from '../debug/DebugPanel'
import { PlaylistPanel } from '../playlist/PlaylistPanel'
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
    chooseFolder, cursorVisible, handleDebugImage, handleFile, handleFolder, handlePlayerMouseMove,
    handleVideoDrop, hasVideo, openVideoFile, setDebugImageInput, setFaceHint, setFileInput,
    setFolderInput, setFpsMeter, setPlayer, setSampleCanvas, setVideo, setVrMount, setVrRoot,
  } = frame
  const { handleVolumeChange, playNextPlaylistVideo, setPlaying, syncTime } = playback
  const { state: displayState } = display
  const {
    closeDebugPanel, debugFaces, debugImageUrl, debugPanelOpen, debugStatus,
    detectDebugImage, openDebugImageFile, setDebugImage,
  } = debug
  return (
    <main
      ref={setPlayer}
      id="player"
      class={`relative h-dvh overflow-hidden bg-black text-white ${cursorVisible() ? '' : 'cursor-none'}`}
      onMouseMove={handlePlayerMouseMove}
      onDragOver={(event) => event.preventDefault()}
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
      <input ref={setDebugImageInput} type="file" accept="image/*" class="hidden" onChange={handleDebugImage} />

      <PlayerStage
        videoOnly={displayState.videoOnly}
        setVrRoot={setVrRoot}
        setVrMount={setVrMount}
        setFpsMeter={setFpsMeter}
        setSampleCanvas={setSampleCanvas}
        setFaceHint={setFaceHint}
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

      <PlaylistPanel controller={playlist} />
      <PlayerControls
        controls={controls}
        display={display}
        playback={playback}
        playlist={playlist}
      />

      <Show when={debugPanelOpen()}>
        <DebugPanel
          status={debugStatus()}
          imageUrl={debugImageUrl()}
          faces={debugFaces()}
          setImage={setDebugImage}
          onImageLoad={detectDebugImage}
          onUpload={openDebugImageFile}
          onClose={closeDebugPanel}
        />
      </Show>
    </main>
  )
}
