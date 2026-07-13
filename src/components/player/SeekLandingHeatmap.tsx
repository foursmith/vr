import { createEffect, createSignal, onSettled } from "solid-js"

interface HeatmapSize { width: number, height: number, pixelRatio: number }

export function SeekLandingHeatmap(props: { counts: number[], progress: number }) {
  let baseCanvas!: HTMLCanvasElement
  let playedCanvas!: HTMLCanvasElement
  const [size, setSize] = createSignal<HeatmapSize>({ width: 0, height: 0, pixelRatio: 1 })

  onSettled(() => {
    const resize = () => {
      const bounds = baseCanvas.getBoundingClientRect()
      setSize({
        width: Math.round(bounds.width),
        height: Math.round(bounds.height),
        pixelRatio: Math.min(2, window.devicePixelRatio || 1),
      })
    }
    const observer = new ResizeObserver(resize)
    observer.observe(baseCanvas)
    resize()
    return () => observer.disconnect()
  })

  createEffect(
    () => ({ counts: props.counts, size: size() }),
    ({ counts, size }) => {
      if (!size.width || !size.height) return
      const baseline = size.height - 3
      const maximumHeight = size.height * 0.72
      const maximumCount = counts.reduce((maximum, count) => Math.max(maximum, count), 1)
      const duration = Math.max(1, counts.length - 1)
      const segments: Array<Array<{ height: number, second: number, x: number }>> = []
      for (let second = 0; second < counts.length; second += 1) {
        const count = counts[second]
        if (!count) continue
        const point = {
          height: Math.max(0.08, Math.sqrt(count / maximumCount)),
          second,
          x: (second / duration) * size.width,
        }
        const segment = segments.at(-1)
        if (!segment?.length || second - segment.at(-1)!.second > 3) segments.push([point])
        else segment.push(point)
      }
      const shoulder = Math.min(4, Math.max(1.5, size.width / duration / 2))

      const drawHeatmap = (canvas: HTMLCanvasElement, color: string) => {
        canvas.width = Math.round(size.width * size.pixelRatio)
        canvas.height = Math.round(size.height * size.pixelRatio)
        const context = canvas.getContext("2d")
        if (!context) return
        context.scale(size.pixelRatio, size.pixelRatio)
        context.fillStyle = color
        for (const points of segments) {
          const first = points[0]
          context.beginPath()
          context.moveTo(Math.max(0, first.x - shoulder), baseline)
          if (points.length === 1) {
            const peakY = baseline - first.height * maximumHeight
            context.quadraticCurveTo(first.x - shoulder * 0.35, peakY, first.x, peakY)
            context.quadraticCurveTo(first.x + shoulder * 0.35, peakY, Math.min(size.width, first.x + shoulder), baseline)
          } else {
            context.lineTo(first.x, baseline - first.height * maximumHeight)
            for (let index = 1; index < points.length; index += 1) {
              const previous = points[index - 1]
              const current = points[index]
              const halfDistance = (current.x - previous.x) / 2
              context.bezierCurveTo(
                previous.x + halfDistance,
                baseline - previous.height * maximumHeight,
                current.x - halfDistance,
                baseline - current.height * maximumHeight,
                current.x,
                baseline - current.height * maximumHeight,
              )
            }
            context.lineTo(Math.min(size.width, points.at(-1)!.x + shoulder), baseline)
          }
          context.closePath()
          context.fill()
        }
        context.fillStyle = "rgba(255,255,255,0.24)"
        context.fillRect(0, baseline, size.width, 2)
      }

      drawHeatmap(baseCanvas, "rgba(255,255,255,0.26)")
      drawHeatmap(playedCanvas, "rgba(255,255,255,0.44)")
    },
  )

  return (
    <div class="pointer-events-none relative h-full w-full" aria-hidden="true">
      <canvas ref={baseCanvas} class="absolute inset-0 h-full w-full"></canvas>
      <canvas
        ref={playedCanvas}
        class="absolute inset-0 h-full w-full"
        style={{ "clip-path": `inset(0 ${100 - Math.min(100, Math.max(0, props.progress))}% 0 0)` }}
      >
      </canvas>
    </div>
  )
}
