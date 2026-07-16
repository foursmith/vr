const fileStem = (name: string) => name.replace(/\.[^.]+$/, "")

const normalizedName = (name: string) => fileStem(name)
  .normalize("NFKD")
  .toLocaleLowerCase()
  .replace(/\b(zh|zho|chi|chs|cht|cn|eng|en|english|subtitle|sub)\b/g, " ")
  .replace(/[^\p{L}\p{N}]+/gu, " ")
  .trim()

const bigrams = (value: string) => {
  const compact = value.replace(/\s+/g, "")
  if (compact.length < 2) return new Set(compact ? [compact] : [])
  return new Set(Array.from({ length: compact.length - 1 }, (_, index) => compact.slice(index, index + 2)))
}

export const subtitleMatchScore = (videoName: string, subtitleName: string) => {
  const video = normalizedName(videoName)
  const subtitle = normalizedName(subtitleName)
  if (!video || !subtitle) return 0
  if (video === subtitle) return 1
  if (video.includes(subtitle) || subtitle.includes(video)) {
    return 0.82 + 0.18 * (Math.min(video.length, subtitle.length) / Math.max(video.length, subtitle.length))
  }
  const left = bigrams(video)
  const right = bigrams(subtitle)
  let overlap = 0
  left.forEach((part) => {
    if (right.has(part)) overlap += 1
  })
  return left.size + right.size ? (2 * overlap) / (left.size + right.size) : 0
}
