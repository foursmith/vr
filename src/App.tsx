import { UnsupportedBrowser } from './components/UnsupportedBrowser'
import { Player } from './components/player/Player'
import { createPlayerController } from './features/player/controller'
import { isChromiumBrowser } from './lib/browser'

function PlayerApp() {
  const player = createPlayerController()

  return (
    <Player
      controls={player.controls}
      debug={player.debug}
      display={player.display}
      frame={player.frame}
      playback={player.playback}
      playlist={player.playlist}
    />
  )
}

export function App() {
  return isChromiumBrowser() ? <PlayerApp /> : <UnsupportedBrowser />
}
