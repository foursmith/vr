export interface SubtitleCue { start: number, end: number, text: string }

const parseTimestamp = (value: string) => {
  const parts = value.trim().replace(",", ".").split(":").map(Number)
  if (parts.some(part => !Number.isFinite(part))) return NaN
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  return NaN
}

const cleanText = (value: string) => value
  .replace(/<br\s*\/?>/gi, "\n")
  .replace(/<[^>]+>/g, "")
  .replace(/\{\\[^}]+\}/g, "")
  .replace(/\\N/gi, "\n")
  .trim()

const parseSrtOrVtt = (source: string) => source.replace(/^\uFEFF/, "").split(/\r?\n\s*\n/).flatMap((block) => {
  const lines = block.trim().split(/\r?\n/)
  const timingIndex = lines.findIndex(line => line.includes("-->"))
  if (timingIndex < 0) return []
  const [startValue, endValue] = lines[timingIndex].split("-->").map(value => value.trim().split(/\s+/)[0])
  const start = parseTimestamp(startValue)
  const end = parseTimestamp(endValue)
  const text = cleanText(lines.slice(timingIndex + 1).join("\n"))
  return Number.isFinite(start) && Number.isFinite(end) && end > start && text ? [{ start, end, text }] : []
})

const parseAss = (source: string) => source.split(/\r?\n/).flatMap((line) => {
  if (!/^Dialogue:/i.test(line)) return []
  const fields = line.replace(/^Dialogue:\s*/i, "").split(",")
  if (fields.length < 10) return []
  const start = parseTimestamp(fields[1])
  const end = parseTimestamp(fields[2])
  const text = cleanText(fields.slice(9).join(","))
  return Number.isFinite(start) && Number.isFinite(end) && end > start && text ? [{ start, end, text }] : []
})

export const parseSubtitle = (source: string, fileName: string): SubtitleCue[] => {
  const cues = /\.(?:ass|ssa)$/i.test(fileName) ? parseAss(source) : parseSrtOrVtt(source)
  return cues.sort((a, b) => a.start - b.start)
}

export const activeSubtitleText = (cues: SubtitleCue[], time: number) => {
  let low = 0
  let high = cues.length
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (cues[middle].end <= time) low = middle + 1
    else high = middle
  }
  return cues[low]?.start <= time && time < cues[low].end ? cues[low].text : ""
}
