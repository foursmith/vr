import { flush } from 'solid-js'
import { render } from '@solidjs/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Player } from '../../src/components/player/Player'

const mocks = vi.hoisted(() => ({
  sceneController: {
    update: vi.fn(),
    resetMedia: vi.fn(),
    destroy: vi.fn(),
  },
  preload: vi.fn(async (onProgress: (value: { loaded: number; total: number; label: string }) => void) => {
    onProgress({ loaded: 1, total: 2, label: 'Halfway' })
    onProgress({ loaded: 2, total: 2, label: 'Loaded' })
  }),
  createVrScene: vi.fn(),
  releaseResources: vi.fn(),
}))

vi.mock('../../src/features/vr/scene', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/features/vr/scene')>(),
  createVrScene: mocks.createVrScene,
  preloadFaceAutoCenterResources: mocks.preload,
}))
vi.mock('../../src/features/face-tracking/client', () => ({ releaseFaceAutoCenterResources: mocks.releaseResources }))

import { createPlayerController } from '../../src/features/player/controller'

const settle = async () => {
  await Promise.resolve()
  flush()
}

const setupController = () => {
  const host = document.createElement('div')
  document.body.append(host)
  let controller!: ReturnType<typeof createPlayerController>
  const Harness = () => {
    controller = createPlayerController()
    return <Player controller={controller} />
  }
  const disposeRender = render(() => <Harness />, host)
  const video = host.querySelector('video')!
  let paused = true
  Object.defineProperties(video, {
    paused: { configurable: true, get: () => paused },
    currentSrc: { configurable: true, get: () => video.getAttribute('src') ?? '' },
    duration: { configurable: true, writable: true, value: 120 },
  })
  video.play = vi.fn(async () => { paused = false })
  video.pause = vi.fn(() => { paused = true })
  video.load = vi.fn()
  const dispose = () => {
    disposeRender()
    host.remove()
  }
  return { controller, dispose, host, video }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
  })
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: vi.fn(() => 'blob:test-video'),
    revokeObjectURL: vi.fn(),
  })
  mocks.preload.mockClear()
  mocks.releaseResources.mockClear()
  mocks.createVrScene.mockReset().mockReturnValue(mocks.sceneController)
  Object.values(mocks.sceneController).forEach((mock) => mock.mockClear())
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  document.body.replaceChildren()
})

describe('player controller', () => {
  it('initializes resources and creates a ready scene', async () => {
    const { controller, dispose, video } = setupController()
    await controller.playback.startInitialLoad()
    await settle()
    expect(mocks.preload).toHaveBeenCalledOnce()
    expect(controller.playback.loadingState).toMatchObject({ resourcesReady: true, progress: 100, label: 'Ready' })
    expect(mocks.createVrScene).toHaveBeenCalledOnce()
    dispose()
    expect(mocks.sceneController.destroy).toHaveBeenCalledOnce()
    expect(mocks.releaseResources).toHaveBeenCalledOnce()
    expect(video.pause).toHaveBeenCalled()
  })

  it('clamps seeking and volume and updates display settings', async () => {
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

    controller.display.setVideoOnly(true)
    controller.display.setPresetId(2)
    await settle()
    expect(controller.display.state.videoOnly).toBe(true)
    expect(controller.display.state.presetId).toBe(2)
    dispose()
  })

  it('reports initialization failures and allows retry', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mocks.preload.mockRejectedValueOnce(new Error('model unavailable'))
    const { controller, dispose } = setupController()
    await controller.playback.startInitialLoad()
    await settle()
    expect(warning).toHaveBeenCalledWith('initial resource loading failed', expect.objectContaining({ message: 'model unavailable' }))
    expect(controller.playback.loadingState.error).toBe('Resource loading failed')
    expect(controller.playback.loadingState.resourcesReady).toBe(false)
    await controller.playback.startInitialLoad()
    await settle()
    expect(controller.playback.loadingState.resourcesReady).toBe(true)
    dispose()
    warning.mockRestore()
  })
})
