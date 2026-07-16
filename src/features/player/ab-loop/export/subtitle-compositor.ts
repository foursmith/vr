import type { VrSceneController } from "../../../vr/scene"

const wrapCanvasText = (context: CanvasRenderingContext2D, text: string, maxWidth: number) => text
  .split("\n")
  .flatMap((paragraph) => {
    if (!paragraph) return [""]
    const tokens = paragraph.includes(" ")
      ? paragraph.split(/(\s+)/).filter(Boolean)
      : Array.from(paragraph)
    const lines: string[] = []
    let line = ""
    tokens.forEach((token) => {
      const candidate = line + token
      if (line && context.measureText(candidate).width > maxWidth) {
        lines.push(line.trimEnd())
        line = token.trimStart()
      } else {
        line = candidate
      }
    })
    if (line || !lines.length) lines.push(line.trimEnd())
    return lines
  })

export interface SubtitleCompositorOptions {
  scene: VrSceneController
  sourceCanvas: HTMLCanvasElement
  mount: HTMLElement
  getText: () => string
}

export const createSubtitleCompositor = (options: SubtitleCompositorOptions) => {
  const canvas = document.createElement("canvas")
  const context = canvas.getContext("2d", { alpha: false })
  if (!context) throw new Error("The current view could not be composed.")

  const draw = (viewCanvas: HTMLCanvasElement) => {
    if (canvas.width !== viewCanvas.width || canvas.height !== viewCanvas.height) {
      canvas.width = viewCanvas.width
      canvas.height = viewCanvas.height
    }
    context.drawImage(viewCanvas, 0, 0, canvas.width, canvas.height)
    const text = options.getText()
    if (!text) return

    const cssWidth = Math.max(1, viewCanvas.clientWidth || options.mount.clientWidth || canvas.width)
    const cssHeight = Math.max(1, viewCanvas.clientHeight || options.mount.clientHeight || canvas.height)
    const scale = canvas.width / cssWidth
    const fontSize = Math.min(28, Math.max(16, cssWidth * 0.022)) * scale
    const lineHeight = fontSize * 1.38
    const maxTextWidth = Math.min(cssWidth * 0.86, 1152) * scale
    context.font = `600 ${fontSize}px system-ui, -apple-system, sans-serif`
    const lines = wrapCanvasText(context, text, maxTextWidth)
    const blockHeight = lines.length * lineHeight
    const bottom = canvas.height - cssHeight * 0.14 * (canvas.height / cssHeight)
    const top = bottom - blockHeight
    context.textAlign = "center"
    context.textBaseline = "top"
    context.lineJoin = "round"
    context.fillStyle = "#fff"
    context.strokeStyle = "rgba(0,0,0,0.82)"
    context.lineWidth = Math.max(2, 3 * scale)
    lines.forEach((line, index) => {
      const y = top + index * lineHeight
      context.strokeText(line, canvas.width / 2, y)
      context.fillText(line, canvas.width / 2, y)
    })
  }

  draw(options.sourceCanvas)
  options.scene.setFrameCapture(draw)
  return {
    canvas,
    destroy: () => options.scene.setFrameCapture(),
  }
}
