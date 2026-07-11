import { createRoot, flush } from 'solid-js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createControls } from '../../src/features/player/controls'

afterEach(() => vi.useRealTimers())

describe('player controls', () => {
  it('keeps controls visible without media and hides them after media inactivity', () => {
    vi.useFakeTimers()
    let hasVideo = false
    let dispose!: () => void
    const controls = createRoot((rootDispose) => {
      dispose = rootDispose
      return createControls({ hasVideo: () => hasVideo, playlistOpen: () => false, resourcesReady: () => true })
    })
    controls.scheduleHideControls(10)
    vi.advanceTimersByTime(10)
    flush()
    expect(controls.controlsVisible()).toBe(true)

    hasVideo = true
    controls.scheduleHideControls(10)
    vi.advanceTimersByTime(10)
    flush()
    expect(controls.controlsVisible()).toBe(false)
    controls.showControls()
    flush()
    expect(controls.controlsVisible()).toBe(true)
    controls.dispose()
    dispose()
  })

  it('positions, shows, schedules and cancels slider popovers', () => {
    vi.useFakeTimers()
    let dispose!: () => void
    const controls = createRoot((rootDispose) => {
      dispose = rootDispose
      return createControls({ hasVideo: () => true, playlistOpen: () => false, resourcesReady: () => true })
    })
    const panel = document.createElement('div')
    const button = document.createElement('button')
    vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue({ left: 100, right: 500, top: 400, bottom: 700, width: 400, height: 300, x: 100, y: 400, toJSON: () => ({}) })
    vi.spyOn(button, 'getBoundingClientRect').mockReturnValue({ left: 180, right: 220, top: 620, bottom: 660, width: 40, height: 40, x: 180, y: 620, toJSON: () => ({}) })
    controls.setControlsPanel(panel)
    controls.showSlider('volume', button)
    flush()
    expect(controls.activeSlider()).toBe('volume')
    expect(controls.sliderAnchor()).toEqual({ x: 100, bottom: 90 })

    controls.scheduleHideSlider(10)
    controls.cancelHideSlider()
    vi.advanceTimersByTime(10)
    expect(controls.activeSlider()).toBe('volume')
    controls.scheduleHideSlider(10)
    vi.advanceTimersByTime(10)
    flush()
    expect(controls.activeSlider()).toBeUndefined()
    controls.dispose()
    dispose()
  })
})
