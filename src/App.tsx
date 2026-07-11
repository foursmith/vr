import { Player } from "./components/player/Player"
import { UnsupportedBrowser } from "./components/UnsupportedBrowser"
import { createPlayerController } from "./features/player/controller"
import { isChromiumBrowser } from "./lib/browser"

function PlayerApp() {
  const player = createPlayerController()

  return <Player controller={player} />
}

export function App() {
  return isChromiumBrowser() ? <PlayerApp /> : <UnsupportedBrowser />
}
