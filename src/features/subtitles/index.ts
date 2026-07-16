import { createMemo, createSignal } from "solid-js"
import { activeSubtitleText, parseSubtitle } from "./parser"

export interface SubtitleResource {
  name: string
  file?: File
  url?: string
}

interface SubtitlesOptions {
  getCurrentTime: () => number
  initialEnabled: boolean
  isCurrentLoad: (generation: number) => boolean
}

export const createSubtitles = (options: SubtitlesOptions) => {
  const [cues, setCues] = createSignal<ReturnType<typeof parseSubtitle>>([])
  const [enabled, setEnabled] = createSignal(options.initialEnabled)
  const [fileName, setFileName] = createSignal<string>()

  const clear = () => {
    setCues([])
    setFileName(undefined)
  }

  const load = async (resource: SubtitleResource | undefined, generation: number) => {
    if (!resource) {
      clear()
      return
    }
    try {
      const text = resource.file
        ? await resource.file.text()
        : await fetch(resource.url!).then((response) => {
            if (!response.ok) throw new Error(`subtitle request failed (${response.status})`)
            return response.text()
          })
      const parsedCues = parseSubtitle(text, resource.name)
      if (!options.isCurrentLoad(generation)) return
      setCues(parsedCues)
      setFileName(resource.name)
    } catch (error) {
      if (!options.isCurrentLoad(generation)) return
      clear()
      console.warn("subtitle loading failed", error)
    }
  }

  const getTextAt = (time: number) => activeSubtitleText(cues(), time)
  const text = createMemo(() => enabled() ? getTextAt(options.getCurrentTime()) : "")

  return {
    clear,
    cues,
    enabled,
    fileName,
    getTextAt,
    hasSubtitle: () => cues().length > 0,
    load,
    text,
    toggle: () => setEnabled(current => !current),
  }
}
