type UpdateReadyListener = (ready: boolean) => void

let updateReady = false
const listeners = new Set<UpdateReadyListener>()

export const markPwaUpdateReady = () => {
  updateReady = true
  listeners.forEach(listener => listener(true))
}

export const subscribePwaUpdateReady = (listener: UpdateReadyListener) => {
  listener(updateReady)
  listeners.add(listener)
  return () => listeners.delete(listener)
}
