import { Player } from "./components/player/Player"
import { createPlayerController } from "./features/player/controller"

export function App() {
  const player = createPlayerController()

  return <Player controller={player} />
}
