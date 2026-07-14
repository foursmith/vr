import { render } from "@solidjs/web"
import { indexedDB } from "fake-indexeddb"
import { flush } from "solid-js"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Player } from "../../src/components/player/Player"

import { createPlayerController } from "../../src/features/player/controller"
import { loadGlobalPreferences, loadVideoPlaybackState, videoStateKey } from "../../src/features/player/playback-state"

const mocks = vi.hoisted(() => ({
  sceneController: {
    update: vi.fn(),
    getOutputCanvas: vi.fn(),
    setFrameCapture: vi.fn(),
    resetMedia: vi.fn(),
    destroy: vi.fn(),
  },
  preload: vi.fn(async (onProgress: (value: { loaded: number, total: number, label: string }) => void) => {
    onProgress({ loaded: 1, total: 2, label: "Halfway" })
    onProgress({ loaded: 2, total: 2, label: "Loaded" })
  }),
  createVrScene: vi.fn(),
  releaseResources: vi.fn(),
}))

vi.mock("../../src/features/vr/scene", async importOriginal => ({
  ...await importOriginal<typeof import("../../src/features/vr/scene")>(),
  createVrScene: mocks.createVrScene,
  preloadFaceAutoCenterResources: mocks.preload,
}))
vi.mock("../../src/features/face-tracking/client", () => ({ releaseFaceAutoCenterResources: mocks.releaseResources }))
vi.mock("../../src/components/player/OceanBackground", () => ({ OceanBackground: () => <canvas aria-hidden="true" /> }))

const settle = async () => {
  await Promise.resolve()
  flush()
}

const setupController = (options: { connectFsvr?: boolean } = {}) => {
  const host = document.createElement("div")
  document.body.append(host)
  let controller!: ReturnType<typeof createPlayerController>
  const Harness = () => {
    controller = createPlayerController(options)
    return <Player controller={controller} />
  }
  const disposeRender = render(() => <Harness />, host)
  const video = host.querySelector("video")!
  let paused = true
  Object.defineProperties(video, {
    paused: { configurable: true, get: () => paused },
    currentSrc: { configurable: true, get: () => video.getAttribute("src") ?? "" },
    duration: { configurable: true, writable: true, value: 120 },
  })
  video.play = vi.fn(async () => {
    paused = false
  })
  video.pause = vi.fn(() => {
    paused = true
  })
  video.load = vi.fn()
  const dispose = () => {
    disposeRender()
    host.remove()
  }
  return { controller, dispose, host, video }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal("indexedDB", indexedDB)
  localStorage.clear()
  vi.stubGlobal("matchMedia", vi.fn((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(() => false),
  })))
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    disconnect() {}
  })
  vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1))
  vi.stubGlobal("cancelAnimationFrame", vi.fn())
  const BrowserURL = URL
  vi.stubGlobal("URL", class extends BrowserURL {
    static createObjectURL = vi.fn(() => "blob:test-video")
    static revokeObjectURL = vi.fn()
  })
  mocks.preload.mockClear()
  mocks.releaseResources.mockClear()
  mocks.createVrScene.mockReset().mockReturnValue(mocks.sceneController)
  Object.values(mocks.sceneController).forEach(mock => mock.mockClear())
  mocks.sceneController.getOutputCanvas.mockReset()
  mocks.sceneController.setFrameCapture.mockReset()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  document.body.replaceChildren()
})

describe("player controller", () => {
  it("does not probe the fsvr status endpoint in pure web mode", async () => {
    const fetch = vi.fn()
    vi.stubGlobal("fetch", fetch)
    const { dispose } = setupController()
    await settle()
    expect(fetch).not.toHaveBeenCalled()
    dispose()
  })

  it("requires unlocking before enabling local file imports in fsvr mode", async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input))
      if (url.pathname === "/api/v1/status") return Response.json({ name: "fsvr" })
      if (url.pathname === "/api/v1/auth" && init?.method === "POST") return Response.json({ authenticated: true })
      if (url.pathname === "/api/v1/auth") return Response.json({ authenticated: false })
      if (url.pathname === "/api/v1/sources") return Response.json([])
      return Response.json({ error: "not found" }, { status: 404 })
    })
    vi.stubGlobal("fetch", fetch)

    const { controller, dispose, host } = setupController({ connectFsvr: true })
    for (let index = 0; index < 6; index += 1) await settle()

    expect(controller.server.state.status).toBe("authentication-required")
    expect(host.querySelector("form[aria-label='Unlock media server']")).not.toBeNull()
    expect(host.textContent).not.toContain("Choose files")
    expect([...host.querySelectorAll<HTMLInputElement>("input[type='file']")].every(input => input.disabled)).toBe(true)

    const passwordInput = host.querySelector<HTMLInputElement>("input[aria-label='Password']")!
    passwordInput.value = "secret"
    passwordInput.dispatchEvent(new Event("input", { bubbles: true }))
    await settle()
    host.querySelector<HTMLButtonElement>("button[type='submit']")!.click()
    for (let index = 0; index < 10; index += 1) await settle()

    expect(fetch).toHaveBeenCalledWith(expect.objectContaining({ pathname: "/api/v1/auth" }), expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ password: "secret" }),
    }))
    expect(controller.server.state.status).toBe("connected")
    expect(host.textContent).toContain("Choose files")
    expect([...host.querySelectorAll<HTMLInputElement>("input[type='file']")].every(input => !input.disabled)).toBe(true)
    dispose()
  })

  it("initializes resources and creates a ready scene", async () => {
    const { controller, dispose, video } = setupController()
    await controller.playback.startInitialLoad()
    await settle()
    expect(mocks.preload).toHaveBeenCalledOnce()
    expect(controller.playback.loadingState).toMatchObject({ resourcesReady: true, progress: 100, label: "Ready" })
    expect(mocks.createVrScene).toHaveBeenCalledOnce()
    expect(mocks.createVrScene).toHaveBeenCalledWith(expect.objectContaining({ quality: "sharp", frameRate: 30 }))
    dispose()
    expect(mocks.sceneController.destroy).toHaveBeenCalledOnce()
    expect(mocks.releaseResources).toHaveBeenCalledOnce()
    expect(video.pause).toHaveBeenCalled()
  })

  it("clamps seeking and volume and updates display settings", async () => {
    const { controller, dispose, video } = setupController()
    await settle()
    await controller.playback.startInitialLoad()
    controller.playback.syncTime()
    await settle()
    video.currentTime = 115
    controller.playback.seekBy(10)
    expect(video.currentTime).toBe(120)
    controller.playback.seekBy(-200)
    expect(video.currentTime).toBe(0)
    controller.playback.setVolumeLevel(2)
    await settle()
    expect(video.volume).toBe(1)
    controller.playback.setVolumeLevel(-1)
    await settle()
    expect(video.volume).toBe(0)
    expect(video.muted).toBe(true)

    controller.playback.setPlaybackRateLevel(1.5)
    await settle()
    expect(video.playbackRate).toBe(1.5)
    expect(controller.playback.playbackRate()).toBe(1.5)

    controller.display.setPresetId(2)
    await settle()
    expect(controller.display.state.presetId).toBe(2)

    mocks.sceneController.update.mockClear()
    controller.display.setQualityId(3)
    controller.display.setRenderFrameRateId(1)
    await settle()
    expect(mocks.sceneController.update).toHaveBeenLastCalledWith(expect.objectContaining({ quality: "ultra", frameRate: 24 }))
    dispose()
  })

  it("composites the rendered VR view, active subtitles, and source audio", async () => {
    const viewTrack = { kind: "video", stop: vi.fn() } as unknown as MediaStreamTrack
    const sourceVideoTrack = { kind: "video", stop: vi.fn() } as unknown as MediaStreamTrack
    const audioTrack = { kind: "audio", stop: vi.fn() } as unknown as MediaStreamTrack
    class FakeMediaStream {
      tracks: MediaStreamTrack[]

      constructor(tracks: MediaStreamTrack[] = []) {
        this.tracks = tracks
      }

      getTracks() {
        return this.tracks
      }

      getVideoTracks() {
        return this.tracks.filter(track => track.kind === "video")
      }

      getAudioTracks() {
        return this.tracks.filter(track => track.kind === "audio")
      }
    }
    const recordedStreams: FakeMediaStream[] = []
    const recordedOptions: MediaRecorderOptions[] = []
    class FakeMediaRecorder extends EventTarget {
      static isTypeSupported = vi.fn(() => true)
      mimeType = "video/webm"
      state: RecordingState = "inactive"

      constructor(stream: FakeMediaStream, options: MediaRecorderOptions) {
        super()
        recordedStreams.push(stream)
        recordedOptions.push(options)
      }

      start() {
        this.state = "recording"
      }

      stop() {
        if (this.state === "inactive") return
        this.state = "inactive"
        const dataEvent = new Event("dataavailable")
        Object.defineProperty(dataEvent, "data", { value: new Blob(["view"]) })
        this.dispatchEvent(dataEvent)
        this.dispatchEvent(new Event("stop"))
      }
    }
    vi.stubGlobal("MediaStream", FakeMediaStream)
    vi.stubGlobal("MediaRecorder", FakeMediaRecorder)
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {})

    const drawImage = vi.fn()
    const fillText = vi.fn()
    const exportContext = {
      clearRect: vi.fn(),
      drawImage,
      fillText,
      font: "",
      lineJoin: "miter",
      lineWidth: 1,
      measureText: vi.fn((text: string) => ({ width: text.length * 10 })),
      strokeText: vi.fn(),
      textAlign: "start",
      textBaseline: "alphabetic",
    } as unknown as CanvasRenderingContext2D
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(exportContext)
    const captureExport = vi.fn(() => new FakeMediaStream([viewTrack]))
    Object.defineProperty(HTMLCanvasElement.prototype, "captureStream", { configurable: true, value: captureExport })

    const outputCanvas = document.createElement("canvas")
    mocks.sceneController.getOutputCanvas.mockReturnValue(outputCanvas)

    const { controller, dispose, host, video } = setupController()
    Object.defineProperty(video, "captureStream", {
      configurable: true,
      value: vi.fn(() => new FakeMediaStream([sourceVideoTrack, audioTrack])),
    })
    await controller.playback.startInitialLoad()
    const subtitle = new File([], "movie.srt", { type: "text/plain" })
    Object.defineProperty(subtitle, "text", {
      value: vi.fn(async () => "1\n00:00:01,000 --> 00:00:30,000\nRendered subtitle"),
    })
    const fileInput = host.querySelector<HTMLInputElement>("input[type='file']:not([webkitdirectory])")!
    Object.defineProperty(fileInput, "files", {
      configurable: true,
      value: [new File(["video"], "movie.mp4", { type: "video/mp4" }), subtitle],
    })
    controller.frame.handleFile()
    await vi.advanceTimersByTimeAsync(200)
    await settle()
    await settle()

    video.currentTime = 10
    controller.playback.setAbStart()
    await settle()
    video.currentTime = 20
    controller.playback.setAbEnd()
    controller.display.setRenderFrameRateId(1)
    controller.display.setQualityId(3)
    await settle()

    const exporting = controller.playback.exportAbLoop()
    await settle()
    video.currentTime = 20
    video.dispatchEvent(new Event("timeupdate"))
    await exporting
    await settle()

    expect(captureExport).toHaveBeenCalledWith(24)
    expect(drawImage).toHaveBeenCalledWith(outputCanvas, 0, 0, outputCanvas.width, outputCanvas.height)
    expect(fillText).toHaveBeenCalledWith("Rendered subtitle", outputCanvas.width / 2, expect.any(Number))
    expect(mocks.sceneController.setFrameCapture).toHaveBeenCalledWith(expect.any(Function))
    expect(mocks.sceneController.setFrameCapture).toHaveBeenLastCalledWith()
    expect(recordedStreams).toHaveLength(1)
    expect(recordedStreams[0].getVideoTracks()).toEqual([viewTrack])
    expect(recordedStreams[0].getAudioTracks()).toEqual([audioTrack])
    expect(recordedStreams[0].getTracks()).not.toContain(sourceVideoTrack)
    expect(recordedOptions[0]).toMatchObject({ videoBitsPerSecond: 12_000_000, audioBitsPerSecond: 128_000 })
    expect(controller.playback.abExport.status).toBe("done")
    dispose()
    getContext.mockRestore()
    delete (HTMLCanvasElement.prototype as HTMLCanvasElement & { captureStream?: () => MediaStream }).captureStream
  })

  it("persists global player preferences as one record", async () => {
    const { controller, dispose } = setupController()
    await settle()
    controller.playback.setVolumeLevel(0.4)
    controller.playback.setPlaybackRateLevel(1.5)
    controller.playback.setRepeatMode("folder")
    controller.display.setQualityId(1)
    controller.display.setRenderFrameRateId(1)
    controller.display.setSplitScreen(false)
    controller.display.setFaceAutoCenter(false)
    controller.subtitles.toggle()
    await settle()
    expect(loadGlobalPreferences()).toMatchObject({
      volume: 0.4,
      playbackRate: 1.5,
      repeatMode: "folder",
      qualityId: 1,
      renderFrameRateId: 1,
      splitScreen: false,
      faceAutoCenter: false,
      subtitlesEnabled: false,
    })
    dispose()
  })

  it("expands browser-imported folders through the selected video", async () => {
    const { controller, dispose, host } = setupController()
    const file = new File(["video"], "movie.mp4", { type: "video/mp4" })
    Object.defineProperty(file, "webkitRelativePath", { value: "Series/Season 1/movie.mp4" })
    const folderInput = host.querySelector<HTMLInputElement>("input[webkitdirectory]")!
    Object.defineProperty(folderInput, "files", { configurable: true, value: [file] })

    controller.frame.handleFolder()
    await settle()
    await vi.advanceTimersByTimeAsync(200)
    await settle()

    const series = controller.playlist.state.nodes.find(node => node.name === "Series")!
    const season = series.children!.find(node => node.name === "Season 1")!
    const video = season.children!.find(node => node.name === "movie.mp4")!
    expect(controller.playlist.state.expandedFolderIds).toEqual([series.id, season.id])
    expect(controller.playlist.state.selectedId).toBe(video.id)
    dispose()
  })

  it("reports initialization failures and allows retry", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {})
    mocks.preload.mockRejectedValueOnce(new Error("model unavailable"))
    const { controller, dispose } = setupController()
    await controller.playback.startInitialLoad()
    await settle()
    expect(warning).toHaveBeenCalledWith("initial resource loading failed", expect.objectContaining({ message: "model unavailable" }))
    expect(controller.playback.loadingState.error).toBe("Resource loading failed")
    expect(controller.playback.loadingState.resourcesReady).toBe(false)
    await controller.playback.startInitialLoad()
    await settle()
    expect(controller.playback.loadingState.resourcesReady).toBe(true)
    dispose()
    warning.mockRestore()
  })

  it("restores the last fsvr video from a legacy URL key", async () => {
    const mediaPath = "/api/v1/media/local/Zm9sZGVyL21vdmllLm1wNA"
    localStorage.setItem("foursmith-vr:last-playback", JSON.stringify({
      key: `url:${window.location.origin}${mediaPath}`,
      position: 37,
      presetId: 2,
    }))
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input))
      if (url.pathname === "/api/v1/status") return Response.json({ name: "fsvr" })
      if (url.pathname === "/api/v1/auth") return Response.json({ authenticated: true })
      if (url.pathname === "/api/v1/sources") {
        return Response.json([{ id: "local", name: "Movies", kind: "local" }])
      }
      if (url.pathname === "/api/v1/sources/local/entries" && !url.searchParams.has("path")) {
        return Response.json([{ id: "Zm9sZGVy", name: "folder", kind: "folder" }])
      }
      if (url.pathname === "/api/v1/sources/local/entries" && url.searchParams.get("path") === "Zm9sZGVy") {
        return Response.json([{ id: "Zm9sZGVyL21vdmllLm1wNA", name: "movie.mp4", kind: "video" }])
      }
      return Response.json({ error: "not found" }, { status: 404 })
    }))

    const { controller, dispose, video } = setupController({ connectFsvr: true })
    await settle()
    await vi.advanceTimersByTimeAsync(200)
    await settle()

    expect(video.getAttribute("src")).toBe(`${window.location.origin}${mediaPath}`)
    expect(video.currentTime).toBe(37)
    expect(controller.playlist.state.expandedFolderIds).toEqual([
      "source:local",
      "local:Zm9sZGVy",
    ])
    expect(controller.playlist.state.selectedId).toBe("local:Zm9sZGVyL21vdmllLm1wNA")
    expect(JSON.parse(localStorage.getItem("foursmith-vr:last-playback")!)).toMatchObject({
      key: "fsvr:local/Zm9sZGVyL21vdmllLm1wNA",
      position: 37,
      presetId: 2,
    })
    dispose()
  })

  it("does not persist playback data for DLNA videos", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input))
      if (url.pathname === "/api/v1/status") return Response.json({ name: "fsvr" })
      if (url.pathname === "/api/v1/auth") return Response.json({ authenticated: true })
      if (url.pathname === "/api/v1/sources") {
        return Response.json([{ id: "dlna-device", name: "Media Server", kind: "dlna" }])
      }
      if (url.pathname === "/api/v1/sources/dlna-device/entries") {
        return Response.json([{ id: "video-entry", name: "DLNA movie", kind: "video" }])
      }
      return Response.json({ error: "not found" }, { status: 404 })
    }))

    const { controller, dispose, video } = setupController({ connectFsvr: true })
    for (let index = 0; index < 4; index += 1) await settle()
    await vi.advanceTimersByTimeAsync(0)
    await settle()
    expect(controller.server.state.status).toBe("connected")
    controller.playlist.togglePlaylistFolder("source:dlna-device")
    for (let index = 0; index < 4; index += 1) await settle()
    await vi.advanceTimersByTimeAsync(0)
    await settle()
    expect(controller.playlist.playlistVideos().map(node => node.id)).toContain("dlna-device:video-entry")
    controller.playlist.playPlaylistNode("dlna-device:video-entry")
    await vi.advanceTimersByTimeAsync(200)
    await settle()
    video.currentTime = 48
    controller.playback.syncTime()
    controller.display.setPresetId(2)
    controller.playback.handlePlayingChange(false)
    await settle()

    const mediaUrl = `${window.location.origin}/api/v1/media/dlna-device/video-entry`
    expect(video.getAttribute("src")).toBe(mediaUrl)
    expect(localStorage.getItem("foursmith-vr:last-playback")).toBeNull()
    vi.useRealTimers()
    expect(await loadVideoPlaybackState(videoStateKey({ name: "DLNA movie", url: mediaUrl }))).toBeUndefined()
    dispose()
  })
})
