import { describe, expect, it } from 'vitest'
import { formatTime } from '../../src/lib/format-time'

describe('formatTime', () => {
  it.each([
    [0, '00:00'],
    [5.9, '00:05'],
    [65, '01:05'],
    [3599, '59:59'],
    [3600, '1:00:00'],
    [3661, '1:01:01'],
    [Number.NaN, '00:00'],
    [Number.POSITIVE_INFINITY, '00:00'],
  ])('formats %s as %s', (seconds, expected) => {
    expect(formatTime(seconds)).toBe(expected)
  })
})
