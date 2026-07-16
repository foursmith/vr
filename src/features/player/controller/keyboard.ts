interface PlayerKeyboardOptions {
  adjustForward: (amount: number) => void
  changeQualityBy: (amount: number) => void
  getVolume: () => number
  isReady: () => boolean
  projectionCount: number
  registerActivity: () => void
  resetView: () => void
  seekBy: (amount: number) => void
  setProjectionId: (id: number) => void
  setVolume: (volume: number) => void
  toggleFullscreen: () => void
  toggleMute: () => void
  togglePlay: () => void
}

const isEditableTarget = (target: EventTarget | null) =>
  target instanceof HTMLInputElement
  || target instanceof HTMLSelectElement
  || target instanceof HTMLTextAreaElement
  || (target instanceof HTMLElement && target.isContentEditable)

export const createPlayerKeyboardHandler = (options: PlayerKeyboardOptions) => (event: KeyboardEvent) => {
  if (!options.isReady()) {
    event.preventDefault()
    return
  }
  if (isEditableTarget(event.target)) return

  const seekAmount = event.shiftKey ? 60 : 10
  let handled = true
  switch (event.key) {
    case " ":
      event.preventDefault()
      options.togglePlay()
      break
    case "ArrowLeft":
      event.preventDefault()
      options.seekBy(-seekAmount)
      break
    case "ArrowRight":
      event.preventDefault()
      options.seekBy(seekAmount)
      break
    case "ArrowUp":
      event.preventDefault()
      options.setVolume(options.getVolume() + 0.05)
      break
    case "ArrowDown":
      event.preventDefault()
      options.setVolume(options.getVolume() - 0.05)
      break
    case "m":
    case "M":
      options.toggleMute()
      break
    case "f":
    case "F":
      options.toggleFullscreen()
      break
    case "r":
    case "R":
      options.resetView()
      break
    case "[":
    case "-":
      options.adjustForward(-1)
      break
    case "]":
    case "=":
      options.adjustForward(1)
      break
    case ",":
      options.changeQualityBy(-1)
      break
    case ".":
      options.changeQualityBy(1)
      break
    default: {
      const projectionNumber = Number(event.key)
      if (Number.isInteger(projectionNumber) && projectionNumber >= 1 && projectionNumber <= options.projectionCount) {
        options.setProjectionId(projectionNumber - 1)
      } else {
        handled = false
      }
    }
  }
  if (handled) options.registerActivity()
}
