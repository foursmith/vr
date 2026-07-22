export type PwaUpdateState = "idle" | "ready" | "applying" | "successful"

type ApplyUpdate = () => Promise<void>
type UpdateStateListener = (state: PwaUpdateState) => void

const PENDING_KEY = "foursmith-vr:pwa-update-pending"
const SUCCESS_KEY = "foursmith-vr:pwa-update-successful"

const pendingAtStartup = localStorage.getItem(PENDING_KEY) === "true"
const successfulAtStartup = sessionStorage.getItem(SUCCESS_KEY) === "true"

if (successfulAtStartup) {
  sessionStorage.removeItem(SUCCESS_KEY)
  localStorage.removeItem(PENDING_KEY)
}

let updateState: PwaUpdateState = successfulAtStartup ? "successful" : "idle"
let applyUpdate: ApplyUpdate | undefined
const listeners = new Set<UpdateStateListener>()

function setUpdateState(state: PwaUpdateState) {
  updateState = state
  listeners.forEach(listener => listener(state))
}

export const hadPendingPwaUpdateAtStartup = () => pendingAtStartup

export const markPwaUpdateReady = (apply: ApplyUpdate) => {
  applyUpdate = apply
  localStorage.setItem(PENDING_KEY, "true")
  setUpdateState("ready")
}

export const markPwaUpdateSuccessful = () => {
  localStorage.removeItem(PENDING_KEY)
  setUpdateState("successful")
}

export const applyPwaUpdate = async () => {
  if (!applyUpdate || updateState === "applying") return

  setUpdateState("applying")
  sessionStorage.setItem(SUCCESS_KEY, "true")
  localStorage.removeItem(PENDING_KEY)

  try {
    await applyUpdate()
  } catch (error) {
    sessionStorage.removeItem(SUCCESS_KEY)
    localStorage.setItem(PENDING_KEY, "true")
    setUpdateState("ready")
    throw error
  }
}

export const subscribePwaUpdateState = (listener: UpdateStateListener) => {
  listener(updateState)
  listeners.add(listener)
  return () => listeners.delete(listener)
}
