import type { PlaylistNode } from "../playlist"
import type { DlnaDevice } from "./client"
import { createStore } from "solid-js"
import { t } from "../../i18n"
import {
  authenticateFsvr,
  detectFsvr,
  discoverFsvrDlna,
  hasFsvrAuth,
  loadFsvrDlnaDevices,
  loadFsvrPlaylist,
} from "./client"
import { fsvrMediaIdentity, localFsvrVideoLocation } from "./location"

export { loadFsvrEntries } from "./client"
export { fsvrMediaIdentity, fsvrMediaKey } from "./location"
export { isFsvrHostMode } from "./runtime"

interface ServerControllerOptions {
  autoResumePlayback: () => boolean
  clearPlaylist: () => void
  enabled: boolean
  getLastPlaybackKey: () => string | undefined
  getVideoPlaybackKey: (resource: { name: string, url: string }) => string
  importPlaylist: (nodes: PlaylistNode[]) => Promise<void>
  isDisposed: () => boolean
  loadRemoteFolder: (id: string) => Promise<void>
  loadVideoUrl: (url: string, name: string, playlistId?: string) => void
  refreshDlnaPlaylist: (nodes: PlaylistNode[]) => void
  remapLastPlaybackKey: (key: string) => void
  setFolderExpanded: (id: string) => void
}

export const createServerController = (options: ServerControllerOptions) => {
  const [state, setState] = createStore({
    endpoint: "",
    status: "disconnected" as "disconnected" | "connecting" | "authentication-required" | "connected" | "error",
    error: undefined as string | undefined,
    dlnaDevices: [] as DlnaDevice[],
    scanningDlna: false,
  })

  const loadPlaylist = async () => {
    const [nodes, dlnaDevices] = await Promise.all([
      loadFsvrPlaylist(state.endpoint),
      loadFsvrDlnaDevices(state.endpoint),
    ])
    if (options.isDisposed()) return
    options.clearPlaylist()
    await options.importPlaylist(nodes)
    setState((draft) => {
      draft.status = "connected"
      draft.error = undefined
      draft.dlnaDevices = dlnaDevices
    })

    const playbackKey = options.getLastPlaybackKey()
    const identity = playbackKey ? fsvrMediaIdentity(playbackKey) : undefined
    const location = identity?.sourceId === "local" && localFsvrVideoLocation(identity.entryId)
    if (!identity || !location || !nodes.some(node => node.remoteSourceId === "local")) return

    await Promise.resolve()
    for (const folderId of location.folderIds) {
      if (options.isDisposed()) return
      await options.loadRemoteFolder(folderId)
      options.setFolderExpanded(folderId)
      await Promise.resolve()
    }
    const mediaUrl = new URL(
      `/api/v1/media/${encodeURIComponent(identity.sourceId)}/${encodeURIComponent(identity.entryId)}`,
      state.endpoint,
    ).href
    options.remapLastPlaybackKey(options.getVideoPlaybackKey({ name: location.name, url: mediaUrl }))
    if (options.autoResumePlayback()) {
      options.loadVideoUrl(mediaUrl, location.name, `${identity.sourceId}:${identity.entryId}`)
    }
  }

  const authenticate = async (password: string) => {
    if (!password.trim()) throw new Error(t("server.enterPassword"))
    setState((draft) => {
      draft.status = "connecting"
      draft.error = undefined
    })
    try {
      await authenticateFsvr(state.endpoint || window.location.origin, password)
      await loadPlaylist()
    } catch {
      const message = t("server.invalidPassword")
      options.clearPlaylist()
      setState((draft) => {
        draft.status = "authentication-required"
        draft.error = message
      })
      throw new Error(message)
    }
  }

  const connect = async () => {
    const endpoint = window.location.origin
    setState((draft) => {
      draft.endpoint = endpoint
      draft.status = "connecting"
      draft.error = undefined
    })
    try {
      if (!(await detectFsvr(endpoint))) {
        setState((draft) => {
          draft.status = "disconnected"
        })
        return
      }
      if (!(await hasFsvrAuth(endpoint))) {
        setState((draft) => {
          draft.status = "authentication-required"
        })
        return
      }
      await loadPlaylist()
    } catch {
      const message = t("server.connectionFailed")
      setState((draft) => {
        draft.status = "error"
        draft.error = message
      })
      throw new Error(message)
    }
  }

  const scanDlna = async () => {
    if (state.status !== "connected") throw new Error(t("server.connectBeforeDlna"))
    setState((draft) => {
      draft.scanningDlna = true
      draft.error = undefined
    })
    try {
      await discoverFsvrDlna(state.endpoint)
      const [nodes, devices] = await Promise.all([
        loadFsvrPlaylist(state.endpoint),
        loadFsvrDlnaDevices(state.endpoint),
      ])
      if (options.isDisposed()) return
      options.refreshDlnaPlaylist(nodes)
      setState((draft) => {
        draft.dlnaDevices = devices
      })
    } catch {
      const message = t("server.dlnaFailed")
      setState((draft) => {
        draft.error = message
      })
      throw new Error(message)
    } finally {
      setState((draft) => {
        draft.scanningDlna = false
      })
    }
  }

  return {
    authenticate,
    connect,
    enabled: () => options.enabled,
    scanDlna,
    state,
  }
}
