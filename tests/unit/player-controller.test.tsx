import { render } from "@solidjs/web"
import { indexedDB } from "fake-indexeddb"
import { flush } from "solid-js"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Player } from "../../src/components/player/Player"

import { createPlayerController } from "../../src/features/player/controller"
import { DEFAULT_GLOBAL_PREFERENCES, loadGlobalPreferences, loadVideoPlaybackState, saveGlobalPreferences, saveLastPlayback, videoStateKey } from "../../src/features/player/playback-state"

const mocks = vi.hoisted(() => ({
  sceneController: {
    update: vi.fn(),
    getOutputCanvas: vi.fn(),
    setFrameCapture: vi.fn(),
    pauseFaceAutoCenter: vi.fn(),
    resumeFaceAutoCenter: vi.fn(),
    resetMedia: vi.fn(),
    destroy: vi.fn(),
  },
  download: vi.fn(async (onProgress: (value: { loaded: number, total: number, label: string }) => void) => {
    onProgress({ loaded: 1, total: 2, label: "Downloading" })
    onProgress({ loaded: 2, total: 2, label: "Downloaded" })
  }),
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
  downloadFaceTrackingResources: mocks.download,
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
  mocks.download.mockClear()
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

  it("hides auto-resume playback in pure web mode", async () => {
    const { controller, dispose, host } = setupController()
    const fileInput = host.querySelector<HTMLInputElement>("input[type='file']:not([webkitdirectory])")!
    Object.defineProperty(fileInput, "files", {
      configurable: true,
      value: [new File(["video"], "movie.mp4", { type: "video/mp4" })],
    })

    controller.frame.handleFile()
    await vi.advanceTimersByTimeAsync(200)
    await settle()
    host.querySelector<HTMLButtonElement>("button[aria-label='Settings']")!.click()
    await settle()

    expect(host.querySelector("button[aria-label='Auto-resume playback']")).toBeNull()
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
    expect(mocks.download).not.toHaveBeenCalled()
    expect(mocks.preload).not.toHaveBeenCalled()
    expect(controller.playback.loadingState).toMatchObject({ resourcesReady: true, progress: 100, label: "Ready" })
    expect(mocks.createVrScene).toHaveBeenCalledOnce()
    expect(mocks.createVrScene).toHaveBeenCalledWith(expect.objectContaining({
      quality: "sharp",
      frameRate: 60,
      faceAutoCenter: true,
    }))
    dispose()
    expect(mocks.sceneController.destroy).toHaveBeenCalledOnce()
    expect(mocks.releaseResources).not.toHaveBeenCalled()
    expect(video.pause).toHaveBeenCalled()
  })

  it("exposes the scene's manual portrait-centering pause and resume action", async () => {
    const { controller, dispose, host } = setupController()
    await controller.playback.startInitialLoad()
    const options = mocks.createVrScene.mock.calls[0]![0]

    controller.display.setZoom(1.2)
    expect(mocks.sceneController.pauseFaceAutoCenter).toHaveBeenCalledOnce()

    options.onFaceAutoCenterPauseChange(true)
    await settle()
    host.querySelector<HTMLButtonElement>("button[aria-label='Resume portrait centering']")!.click()

    expect(controller.frame.faceAutoCenterPaused()).toBe(true)
    expect(mocks.sceneController.resumeFaceAutoCenter).toHaveBeenCalledOnce()

    options.onFaceAutoCenterPauseChange(false)
    await settle()
    expect(host.querySelector("button[aria-label='Resume portrait centering']")).toBeNull()
    dispose()
  })

  it("stops playback and restores the empty state when clearing the playlist", async () => {
    const { controller, dispose, host, video } = setupController()
    const fileInput = host.querySelector<HTMLInputElement>("input[type='file']:not([webkitdirectory])")!
    Object.defineProperty(fileInput, "files", {
      configurable: true,
      value: [new File(["video"], "movie.mp4", { type: "video/mp4" })],
    })

    controller.frame.handleFile()
    await vi.advanceTimersByTimeAsync(200)
    await settle()

    expect(controller.frame.hasVideo()).toBe(true)
    expect(video.getAttribute("src")).toBe("blob:test-video")
    expect(controller.playlist.visible()).toBe(true)
    expect(host.querySelector("button[aria-label='Playlist']")).toBeNull()
    expect(host.querySelector("button[aria-label='Close playlist']")).toBeNull()

    controller.playlist.clearPlaylist()
    await settle()

    expect(controller.playlist.state.nodes).toEqual([])
    expect(controller.playlist.visible()).toBe(false)
    expect(controller.frame.hasVideo()).toBe(false)
    expect(controller.playback.playing()).toBe(false)
    expect(video.pause).toHaveBeenCalled()
    expect(video.getAttribute("src")).toBeNull()
    expect(video.load).toHaveBeenCalled()
    expect(host.textContent).toContain("Choose files")
    expect(host.querySelector(".player-controls")).toBeNull()
    dispose()
  })

  it("loops the next video control within the playback folder", async () => {
    const { controller, dispose, host } = setupController()
    const fileInput = host.querySelector<HTMLInputElement>("input[type='file']:not([webkitdirectory])")!
    Object.defineProperty(fileInput, "files", {
      configurable: true,
      value: [
        new File(["first"], "first.mp4", { type: "video/mp4" }),
        new File(["second"], "second.mp4", { type: "video/mp4" }),
        new File(["third"], "third.mp4", { type: "video/mp4" }),
      ],
    })

    controller.frame.handleFile()
    await vi.advanceTimersByTimeAsync(200)
    await settle()

    expect([...host.querySelectorAll(".player-controls button")].slice(0, 2).map(button => button.getAttribute("aria-label"))).toEqual([
      "Play",
      "Next video",
    ])
    host.querySelector<HTMLButtonElement>("button[aria-label='Next video']")!.click()
    await vi.advanceTimersByTimeAsync(200)
    await settle()

    host.querySelector<HTMLButtonElement>("button[aria-label='Next video']")!.click()
    await vi.advanceTimersByTimeAsync(200)
    await settle()

    expect(host.querySelector("button[aria-label='Previous video']")).toBeNull()
    expect(host.querySelector("button[aria-label='Next video']")).not.toBeNull()
    expect(controller.playlist.state.selectedId).toBe(controller.playlist.playlistVideos()[2]?.id)
    host.querySelector<HTMLButtonElement>("button[aria-label='Next video']")!.click()
    await vi.advanceTimersByTimeAsync(200)
    await settle()
    expect(controller.playlist.state.selectedId).toBe(controller.playlist.playlistVideos()[0]?.id)
    dispose()

    const single = setupController()
    const singleFileInput = single.host.querySelector<HTMLInputElement>("input[type='file']:not([webkitdirectory])")!
    Object.defineProperty(singleFileInput, "files", {
      configurable: true,
      value: [new File(["only"], "only.mp4", { type: "video/mp4" })],
    })
    single.controller.frame.handleFile()
    await vi.advanceTimersByTimeAsync(200)
    await settle()

    expect(single.host.querySelector("button[aria-label='Previous video']")).toBeNull()
    expect(single.host.querySelector("button[aria-label='Next video']")).toBeNull()
    expect(single.host.querySelector("button[aria-label='Play']")).not.toBeNull()
    single.dispose()
  })

  it("groups volume, speed, and zoom into one horizontal slider panel", async () => {
    const { controller, dispose, host } = setupController()
    const fileInput = host.querySelector<HTMLInputElement>("input[type='file']:not([webkitdirectory])")!
    Object.defineProperty(fileInput, "files", {
      configurable: true,
      value: [new File(["video"], "movie.mp4", { type: "video/mp4" })],
    })
    controller.frame.handleFile()
    await vi.advanceTimersByTimeAsync(200)
    await settle()

    const adjustmentButton = host.querySelector<HTMLButtonElement>("button[aria-label='Adjust volume, speed, and zoom']")!
    adjustmentButton.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }))
    await settle()
    expect(host.querySelector("section[aria-label='Playback adjustments']")).toBeNull()

    adjustmentButton.click()
    await settle()

    const panel = host.querySelector<HTMLElement>("section[aria-label='Playback adjustments']")!
    expect(panel).not.toBeNull()
    expect([...panel.querySelectorAll("input[type='range']")].map(input => input.getAttribute("aria-label"))).toEqual([
      "Volume",
      "Speed",
      "Zoom",
    ])

    const speed = panel.querySelector<HTMLInputElement>("input[aria-label='Speed']")!
    speed.value = "1.5"
    speed.dispatchEvent(new Event("input", { bubbles: true }))
    await settle()
    expect(controller.playback.playbackRate()).toBe(1.5)

    panel.querySelector<HTMLButtonElement>("button[aria-label='Reset speed']")!.click()
    await settle()
    expect(controller.playback.playbackRate()).toBe(1)

    controller.playback.setVolumeLevel(0.4)
    await settle()
    panel.querySelector<HTMLButtonElement>("button[aria-label='Mute']")!.click()
    await settle()
    expect(controller.playback.volume()).toBe(0)
    expect(panel.querySelector("button[aria-label='Unmute']")).not.toBeNull()
    panel.querySelector<HTMLButtonElement>("button[aria-label='Unmute']")!.click()
    await settle()
    expect(controller.playback.volume()).toBe(0.4)

    controller.display.setZoom(1.4)
    await settle()
    panel.querySelector<HTMLButtonElement>("button[aria-label='Reset zoom']")!.click()
    await settle()
    expect(controller.display.zoom()).toBe(1)

    const settingsButton = host.querySelector<HTMLButtonElement>("button[aria-label='Settings']")!
    speed.focus()
    settingsButton.focus()
    await settle()
    expect(host.querySelector("section[aria-label='Playback adjustments']")).toBeNull()

    const repeatButton = host.querySelector<HTMLButtonElement>("button[aria-label^='Playback mode:']")!
    expect(repeatButton.closest("aside[aria-label='Playlist']")).not.toBeNull()
    expect(repeatButton.querySelector(".i-ph-repeat-once")).not.toBeNull()
    repeatButton.click()
    await settle()
    expect(controller.playback.repeatMode()).toBe("off")
    expect(repeatButton.getAttribute("aria-label")).toBe("Playback mode: Play once")
    expect(host.querySelector("[role='radiogroup'][aria-label='Playback mode']")).toBeNull()
    expect(repeatButton.querySelector(".i-ph-skip-forward")).not.toBeNull()
    repeatButton.click()
    await settle()
    expect(controller.playback.repeatMode()).toBe("folder")
    expect(repeatButton.querySelector(".i-ph-arrows-clockwise")).not.toBeNull()
    repeatButton.click()
    await settle()
    expect(controller.playback.repeatMode()).toBe("file")

    const projectionButton = host.querySelector<HTMLButtonElement>("button[aria-label='Projection']")!
    const initialProjectionIcon = projectionButton.querySelector("svg")!.innerHTML
    projectionButton.click()
    await settle()
    const projectionList = host.querySelector<HTMLElement>("[role='listbox'][aria-label='Projection']")!
    expect(projectionList).not.toBeNull()
    projectionList.querySelector<HTMLButtonElement>("button[data-index='3']")!.click()
    await settle()
    expect(projectionButton.title).toBe("Projection: Flat 2D")
    expect(projectionButton.querySelector("svg")!.innerHTML).not.toBe(initialProjectionIcon)

    projectionButton.click()
    await settle()
    settingsButton.focus()
    await settle()
    expect(host.querySelector("[role='listbox'][aria-label='Projection']")).toBeNull()
    dispose()
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

    controller.display.setProjectionId(2)
    await settle()
    expect(controller.display.state.projectionId).toBe(2)

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
      mimeType: string
      state: RecordingState = "inactive"

      constructor(stream: FakeMediaStream, options: MediaRecorderOptions) {
        super()
        this.mimeType = options.mimeType ?? "video/webm"
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
    const clickDownload = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {})

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
    const jpegBytes = new Uint8Array([0xFF, 0xD8, 0xFF, 0xD9])
    const createJpeg = vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(callback => callback(new Blob([jpegBytes], { type: "image/jpeg" })))
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

    const exporting = controller.playback.exportAbLoop("mp4")
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
    expect(recordedOptions[0]).toMatchObject({ mimeType: expect.stringContaining("video/mp4"), videoBitsPerSecond: 12_000_000, audioBitsPerSecond: 128_000 })
    expect(controller.playback.abExport.status).toBe("done")
    controller.subtitles.toggle()
    await settle()
    getContext.mockClear()
    drawImage.mockClear()
    captureExport.mockClear()
    mocks.sceneController.setFrameCapture.mockClear()

    const exportingWithoutSubtitles = controller.playback.exportAbLoop()
    await settle()
    video.currentTime = 20
    video.dispatchEvent(new Event("timeupdate"))
    await exportingWithoutSubtitles
    await settle()

    expect(captureExport).toHaveBeenCalledWith(24)
    expect(captureExport.mock.contexts[0]).toBe(outputCanvas)
    expect(getContext).not.toHaveBeenCalled()
    expect(drawImage).not.toHaveBeenCalled()
    expect(mocks.sceneController.setFrameCapture).not.toHaveBeenCalled()

    vi.useRealTimers()
    let renderExportFrame: FrameRequestCallback | undefined
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
      renderExportFrame = callback
      return 1
    }))
    vi.stubGlobal("cancelAnimationFrame", vi.fn())
    const exportingMotionPhoto = controller.playback.exportAbLoop("motion-photo")
    renderExportFrame!(0)
    await settle()
    await settle()
    expect(recordedOptions).toHaveLength(3)
    video.currentTime = 20
    video.dispatchEvent(new Event("timeupdate"))
    await exportingMotionPhoto
    await settle()

    expect(createJpeg).toHaveBeenCalledWith(expect.any(Function), "image/jpeg", 0.92)
    expect(recordedOptions.at(-1)).toMatchObject({ mimeType: expect.stringContaining("video/mp4") })
    expect((clickDownload.mock.contexts.at(-1) as HTMLAnchorElement).download).toBe("movie-AB-10-0-20-0.jpg")
    expect(controller.playback.abExport).toMatchObject({ status: "done", format: "motion-photo" })
    dispose()
    createJpeg.mockRestore()
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
    controller.playback.setAutoResumePlayback(true)
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
      autoResumePlayback: true,
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

  it("resumes the last browser file when its folder is imported with startup auto-resume disabled", async () => {
    const first = new File(["first"], "first.mp4", { type: "video/mp4", lastModified: 10 })
    const lastPlayed = new File(["last"], "last.mp4", { type: "video/mp4", lastModified: 20 })
    Object.defineProperty(first, "webkitRelativePath", { value: "Movies/first.mp4" })
    Object.defineProperty(lastPlayed, "webkitRelativePath", { value: "Movies/last.mp4" })
    saveLastPlayback({ key: videoStateKey({ name: lastPlayed.name, file: lastPlayed }), position: 37, projectionId: 2 })

    const { controller, dispose, host, video } = setupController()
    expect(controller.playback.autoResumePlayback()).toBe(false)
    const folderInput = host.querySelector<HTMLInputElement>("input[webkitdirectory]")!
    Object.defineProperty(folderInput, "files", { configurable: true, value: [first, lastPlayed] })

    controller.frame.handleFolder()
    await vi.advanceTimersByTimeAsync(200)
    await settle()

    const selected = controller.playlist.playlistVideos().find(node => node.id === controller.playlist.state.selectedId)
    expect(selected?.name).toBe("last.mp4")
    expect(video.currentTime).toBe(37)
    expect(controller.display.state.projectionId).toBe(2)
    dispose()
  })

  it("reports initialization failures and allows retry", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {})
    mocks.createVrScene.mockImplementationOnce(() => {
      throw new Error("renderer unavailable")
    })
    const { controller, dispose } = setupController()
    await controller.playback.startInitialLoad()
    await settle()
    expect(warning).toHaveBeenCalledWith("initial resource loading failed", expect.objectContaining({ message: "renderer unavailable" }))
    expect(controller.playback.loadingState.error).toBe("Couldn’t get the player ready")
    expect(controller.playback.loadingState.resourcesReady).toBe(false)
    await controller.playback.startInitialLoad()
    await settle()
    expect(controller.playback.loadingState.resourcesReady).toBe(true)
    dispose()
    warning.mockRestore()
  })

  it("restores the last fsvr video from a legacy URL key", async () => {
    saveGlobalPreferences({ ...DEFAULT_GLOBAL_PREFERENCES, autoResumePlayback: true })
    const mediaPath = "/api/v1/media/local/Zm9sZGVyL21vdmllLm1wNA"
    localStorage.setItem("foursmith-vr:last-playback", JSON.stringify({
      key: `url:${window.location.origin}${mediaPath}`,
      position: 37,
      projectionId: 2,
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

    const { controller, dispose, host, video } = setupController({ connectFsvr: true })
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
      projectionId: 2,
    })
    host.querySelector<HTMLButtonElement>("button[aria-label='Settings']")!.click()
    await settle()
    expect(host.querySelector("button[aria-label='Auto-resume playback']")).not.toBeNull()
    dispose()
  })

  it("does not restore the last fsvr video when auto-resume playback is disabled", async () => {
    saveGlobalPreferences({ ...DEFAULT_GLOBAL_PREFERENCES, autoResumePlayback: false })
    localStorage.setItem("foursmith-vr:last-playback", JSON.stringify({
      key: "fsvr:local/Zm9sZGVyL21vdmllLm1wNA",
      position: 37,
      projectionId: 2,
    }))
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
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
    })
    vi.stubGlobal("fetch", fetch)

    const { controller, dispose, video } = setupController({ connectFsvr: true })
    for (let index = 0; index < 8; index += 1) await settle()
    await vi.advanceTimersByTimeAsync(0)
    for (let index = 0; index < 4; index += 1) await settle()

    expect(controller.server.state.status).toBe("connected")
    expect(controller.frame.hasVideo()).toBe(false)
    expect(video.getAttribute("src")).toBeNull()
    expect(controller.playlist.state.expandedFolderIds).toEqual([
      "source:local",
      "local:Zm9sZGVy",
    ])
    expect(controller.playlist.state.selectedId).toBeUndefined()
    dispose()
  })

  it("clears browser imports without removing server sources", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input))
      if (url.pathname === "/api/v1/status") return Response.json({ name: "fsvr" })
      if (url.pathname === "/api/v1/auth") return Response.json({ authenticated: true })
      if (url.pathname === "/api/v1/sources") {
        return Response.json([
          { id: "local", name: "Movies", kind: "local" },
          { id: "dlna-device", name: "Media Server", kind: "dlna" },
        ])
      }
      return Response.json({ error: "not found" }, { status: 404 })
    }))

    const { controller, dispose, host, video } = setupController({ connectFsvr: true })
    for (let index = 0; index < 8; index += 1) await settle()
    await vi.advanceTimersByTimeAsync(0)
    await settle()
    expect(controller.server.state.status).toBe("connected")
    expect(host.querySelector(".player-controls")).toBeNull()
    const fileInput = host.querySelector<HTMLInputElement>("input[type='file']:not([webkitdirectory])")!
    Object.defineProperty(fileInput, "files", {
      configurable: true,
      value: [new File(["video"], "imported.mp4", { type: "video/mp4" })],
    })

    controller.frame.handleFile()
    await vi.advanceTimersByTimeAsync(200)
    await settle()
    expect(host.querySelector(".player-controls")).not.toBeNull()
    expect(controller.playlist.state.nodes.map(node => node.id)).toEqual([
      "source:local",
      "source:dlna-device",
      expect.stringMatching(/^playlist-/),
    ])

    controller.playlist.clearPlaylist()
    await settle()

    expect(controller.playlist.state.nodes.map(node => node.id)).toEqual([
      "source:local",
      "source:dlna-device",
    ])
    expect(controller.playlist.visible()).toBe(true)
    expect(controller.frame.hasVideo()).toBe(false)
    expect(host.querySelector(".player-controls")).toBeNull()
    expect(video.getAttribute("src")).toBeNull()
    expect(controller.playlist.hasBrowserPlaylistItems()).toBe(false)
    dispose()
  })

  it("preserves browser-imported videos while scanning for DLNA devices", async () => {
    let dlnaDiscovered = false
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input))
      if (url.pathname === "/api/v1/status") return Response.json({ name: "fsvr" })
      if (url.pathname === "/api/v1/auth") return Response.json({ authenticated: true })
      if (url.pathname === "/api/v1/dlna/discover" && init?.method === "POST") {
        dlnaDiscovered = true
        return Response.json([{ id: "dlna-device", name: "Media Server", kind: "dlna" }])
      }
      if (url.pathname === "/api/v1/sources") {
        return Response.json([
          { id: "local", name: "Movies", kind: "local" },
          ...(dlnaDiscovered ? [{ id: "dlna-device", name: "Media Server", kind: "dlna" }] : []),
        ])
      }
      return Response.json({ error: "not found" }, { status: 404 })
    }))

    const { controller, dispose, host, video } = setupController({ connectFsvr: true })
    for (let index = 0; index < 8; index += 1) await settle()
    await vi.advanceTimersByTimeAsync(0)
    await settle()

    const fileInput = host.querySelector<HTMLInputElement>("input[type='file']:not([webkitdirectory])")!
    Object.defineProperty(fileInput, "files", {
      configurable: true,
      value: [new File(["video"], "imported.mp4", { type: "video/mp4" })],
    })
    controller.frame.handleFile()
    await vi.advanceTimersByTimeAsync(200)
    await settle()
    const importedId = controller.playlist.state.selectedId

    await controller.server.scanDlna()
    await settle()

    expect(controller.playlist.state.nodes.map(node => node.id)).toEqual([
      "source:local",
      "source:dlna-device",
      expect.stringMatching(/^playlist-/),
    ])
    expect(controller.playlist.state.selectedId).toBe(importedId)
    expect(controller.playlist.hasBrowserPlaylistItems()).toBe(true)
    expect(controller.frame.hasVideo()).toBe(true)
    expect(video.getAttribute("src")).toBe("blob:test-video")
    dispose()
  })

  it("adds DLNA sources without resetting loaded local and DLNA folders", async () => {
    let dlnaDiscovered = false
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input))
      if (url.pathname === "/api/v1/status") return Response.json({ name: "fsvr" })
      if (url.pathname === "/api/v1/auth") return Response.json({ authenticated: true })
      if (url.pathname === "/api/v1/dlna/discover" && init?.method === "POST") {
        dlnaDiscovered = true
        return Response.json([{ id: "dlna-new", name: "New DLNA", kind: "dlna" }])
      }
      if (url.pathname === "/api/v1/sources") {
        return Response.json([
          { id: "local", name: "Movies", kind: "local" },
          { id: "dlna-existing", name: "Existing DLNA", kind: "dlna" },
          ...(dlnaDiscovered ? [{ id: "dlna-new", name: "New DLNA", kind: "dlna" }] : []),
        ])
      }
      if (url.pathname === "/api/v1/sources/local/entries") {
        return Response.json([{ id: "local-video", name: "Local movie", kind: "video" }])
      }
      if (url.pathname === "/api/v1/sources/dlna-existing/entries") {
        return Response.json([{ id: "dlna-video", name: "DLNA movie", kind: "video" }])
      }
      return Response.json({ error: "not found" }, { status: 404 })
    }))

    const { controller, dispose, video } = setupController({ connectFsvr: true })
    for (let index = 0; index < 8; index += 1) await settle()
    await vi.advanceTimersByTimeAsync(0)
    await settle()
    controller.playlist.togglePlaylistFolder("source:local")
    controller.playlist.togglePlaylistFolder("source:dlna-existing")
    for (let index = 0; index < 4; index += 1) await settle()
    controller.playlist.playPlaylistNode("dlna-existing:dlna-video")
    await vi.advanceTimersByTimeAsync(200)
    await settle()

    await controller.server.scanDlna()
    await settle()

    expect(controller.playlist.state.nodes.map(node => node.id)).toEqual([
      "source:local",
      "source:dlna-existing",
      "source:dlna-new",
    ])
    expect(controller.playlist.state.nodes[0]?.children?.map(node => node.id)).toEqual(["local:local-video"])
    expect(controller.playlist.state.nodes[1]?.children?.map(node => node.id)).toEqual(["dlna-existing:dlna-video"])
    expect(controller.playlist.state.selectedId).toBe("dlna-existing:dlna-video")
    expect(video.getAttribute("src")).toBe(`${window.location.origin}/api/v1/media/dlna-existing/dlna-video`)
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
    controller.display.setProjectionId(2)
    controller.playback.handlePlayingChange(false)
    await settle()

    const mediaUrl = `${window.location.origin}/api/v1/media/dlna-device/video-entry`
    expect(video.getAttribute("src")).toBe(mediaUrl)
    controller.playlist.clearPlaylist()
    await settle()
    expect(controller.playlist.state.nodes.map(node => node.id)).toEqual(["source:dlna-device"])
    expect(video.getAttribute("src")).toBe(mediaUrl)
    expect(localStorage.getItem("foursmith-vr:last-playback")).toBeNull()
    vi.useRealTimers()
    expect(await loadVideoPlaybackState(videoStateKey({ name: "DLNA movie", url: mediaUrl }))).toBeUndefined()
    dispose()
  })
})
