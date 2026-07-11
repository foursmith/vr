import { afterEach, describe, expect, it } from 'vitest'
import { isChromiumBrowser } from '../../src/lib/browser'

const originalUserAgent = navigator.userAgent
const originalUserAgentData = (navigator as Navigator & { userAgentData?: unknown }).userAgentData

const setNavigator = (userAgent: string, brands?: Array<{ brand: string; version: string }>) => {
  Object.defineProperty(navigator, 'userAgent', { configurable: true, value: userAgent })
  Object.defineProperty(navigator, 'userAgentData', { configurable: true, value: brands ? { brands } : undefined })
}

afterEach(() => setNavigator(originalUserAgent, (originalUserAgentData as { brands?: Array<{ brand: string; version: string }> } | undefined)?.brands))

describe('isChromiumBrowser', () => {
  it('recognizes Chromium from user-agent client hints', () => {
    setNavigator('unrelated', [{ brand: 'Chromium', version: '126' }])
    expect(isChromiumBrowser()).toBe(true)
  })

  it.each([
    ['Chrome', 'Mozilla/5.0 Chrome/126.0 Safari/537.36', true],
    ['Edge', 'Mozilla/5.0 Chrome/126.0 Safari/537.36 Edg/126.0', true],
    ['Opera', 'Mozilla/5.0 Chrome/126.0 Safari/537.36 OPR/112.0', true],
    ['Firefox', 'Mozilla/5.0 Firefox/128.0', false],
    ['Safari', 'Mozilla/5.0 Version/17.5 Safari/605.1.15', false],
  ])('classifies %s', (_name, userAgent, expected) => {
    setNavigator(userAgent)
    expect(isChromiumBrowser()).toBe(expected)
  })
})
