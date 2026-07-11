import { untrack } from 'solid-js'
import type { PlayerController } from '../../features/player/controller'

export function PlayerStage(props: { controller: PlayerController }) {
  const { debug, frame, playback } = untrack(() => props.controller)
  const { setVideo, setVrMount, setVrRoot } = frame
  return (
    <>
      <section
        ref={setVrRoot}
        id="vr-scene"
        class="absolute inset-0 h-dvh w-full opacity-100"
      >
        <div ref={setVrMount} id="vr-mount" class="h-full w-full"></div>
        <div class="pointer-events-none absolute inset-0 z-10">
          <div
            ref={debug.setFpsMeter}
            id="fps-meter"
            class="absolute left-3 top-3 hidden whitespace-pre rounded-md border border-white/16 bg-black/68 px-3 py-2 font-mono text-[11px] font-semibold leading-[1.55] text-white/78 shadow-[0_8px_24px_rgba(0,0,0,0.42)] backdrop-blur-md"
            aria-label="Performance metrics"
          >
            FPS --  P95 -- ms
          </div>
          <canvas
            ref={debug.setSampleCanvas}
            id="sample-canvas"
            class="absolute right-3 top-3 hidden aspect-auto w-[min(16rem,24vw)] max-w-[calc(100vw-24px)] rounded-md border border-white/22 bg-black shadow-[0_12px_34px_rgba(0,0,0,0.48),0_0_0_1px_rgba(0,0,0,0.55)]"
          ></canvas>
          <div
            ref={debug.setFaceHint}
            id="face-hint"
            class="absolute top-1/2 -translate-y-1/2 rounded-full border border-[#38ff8b]/44 bg-black/58 px-3 py-2.5 font-mono text-sm text-white font-extrabold leading-none shadow-[0_10px_30px_rgba(0,0,0,0.42),0_0_20px_rgba(56,255,139,0.22)] [text-shadow:0_1px_1px_rgba(0,0,0,0.55)]"
            hidden
          ></div>
        </div>
      </section>

      <video
        ref={setVideo}
        id="video"
        playsinline
        webkit-playsinline="true"
        class="native-video absolute inset-0 hidden h-full w-full bg-black object-contain"
        onTimeUpdate={playback.syncTime}
        onLoadedMetadata={playback.syncTime}
        onPlaying={() => playback.setPlaying(true)}
        onPause={() => playback.setPlaying(false)}
        onEnded={playback.playNextPlaylistVideo}
        onVolumeChange={playback.handleVolumeChange}
      ></video>
    </>
  )
}
