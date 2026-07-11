import { describe, expect, it } from "vitest"
import { activeSubtitleText, parseSubtitle } from "../../src/features/subtitles/parser"

describe("subtitle parser", () => {
  it("parses SRT and WebVTT cues and resolves the active text", () => {
    const cues = parseSubtitle("1\n00:00:01,200 --> 00:00:03,000\nHello<br>world\n\n00:04.000 --> 00:05.500\nNext", "movie.srt")
    expect(cues).toEqual([
      { start: 1.2, end: 3, text: "Hello\nworld" },
      { start: 4, end: 5.5, text: "Next" },
    ])
    expect(activeSubtitleText(cues, 2)).toBe("Hello\nworld")
    expect(activeSubtitleText(cues, 3.5)).toBe("")
  })

  it("parses ASS dialogue and removes styling commands", () => {
    const source = "[Events]\nDialogue: 0,0:00:02.50,0:00:04.00,Default,,0,0,0,,{\\i1}Hello\\Nworld"
    expect(parseSubtitle(source, "movie.ass")).toEqual([{ start: 2.5, end: 4, text: "Hello\nworld" }])
  })
})
