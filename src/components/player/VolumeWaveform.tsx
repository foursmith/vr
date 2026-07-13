import { createEffect, createSignal, onSettled } from "solid-js"

interface WaveformSize { width: number, height: number, pixelRatio: number }

export function VolumeWaveform(props: { amplitudes: number[], progress: number }) {
  let canvas!: HTMLCanvasElement
  const [size, setSize] = createSignal<WaveformSize>({ width: 0, height: 0, pixelRatio: 1 })

  onSettled(() => {
    const resize = () => {
      const bounds = canvas.getBoundingClientRect()
      setSize({
        width: Math.round(bounds.width),
        height: Math.round(bounds.height),
        pixelRatio: Math.min(2, window.devicePixelRatio || 1),
      })
    }
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)
    resize()
    return () => observer.disconnect()
  })

  createEffect(
    () => ({ amplitudes: props.amplitudes, progress: props.progress, size: size() }),
    ({ amplitudes, progress, size }) => {
      if (!size.width || !size.height) return
      canvas.width = Math.round(size.width * size.pixelRatio)
      canvas.height = Math.round(size.height * size.pixelRatio)
      const context = canvas.getContext("2d")
      if (!context) return
      context.scale(size.pixelRatio, size.pixelRatio)
      context.clearRect(0, 0, size.width, size.height)

      const baseline = size.height - 3
      const maximumHeight = size.height * 0.72
      const playedX = size.width * Math.min(1, Math.max(0, progress / 100))

      const pointCount = Math.max(1, Math.min(amplitudes.length, Math.ceil(size.width / 2)))
      const points = Array.from({ length: pointCount }, (_, point) => {
        const sampleStart = Math.floor((point / pointCount) * amplitudes.length)
        const sampleEnd = Math.max(sampleStart + 1, Math.floor(((point + 1) / pointCount) * amplitudes.length))
        const known = amplitudes.slice(sampleStart, sampleEnd).filter(amplitude => amplitude >= 0)
        return {
          amplitude: known.length ? Math.max(...known) : -1,
          x: pointCount === 1 ? 0 : (point / (pointCount - 1)) * size.width,
        }
      })

      const drawWaveform = (color: string) => {
        context.fillStyle = color
        let segment: typeof points = []
        const closeSegment = () => {
          if (!segment.length) return
          context.beginPath()
          context.moveTo(segment[0].x, baseline)
          context.lineTo(segment[0].x, baseline - Math.max(2, segment[0].amplitude * maximumHeight))
          for (let index = 1; index < segment.length; index += 1) {
            const previous = segment[index - 1]
            const current = segment[index]
            const midpointX = (previous.x + current.x) / 2
            const midpointY = baseline - ((previous.amplitude + current.amplitude) / 2) * maximumHeight
            context.quadraticCurveTo(previous.x, baseline - previous.amplitude * maximumHeight, midpointX, midpointY)
          }
          const last = segment.at(-1)!
          context.lineTo(last.x, baseline - Math.max(2, last.amplitude * maximumHeight))
          context.lineTo(last.x, baseline)
          context.closePath()
          context.fill()
          segment = []
        }
        for (const point of points) {
          if (point.amplitude < 0) closeSegment()
          else segment.push(point)
        }
        closeSegment()
      }

      drawWaveform("rgba(255,255,255,0.26)")
      context.save()
      context.beginPath()
      context.rect(0, 0, playedX, size.height)
      context.clip()
      drawWaveform("rgba(255,255,255,0.44)")
      context.restore()
      context.fillStyle = "rgba(255,255,255,0.24)"
      context.fillRect(0, baseline, size.width, 2)
    },
  )

  return <canvas ref={canvas} class="pointer-events-none h-full w-full" aria-hidden="true"></canvas>
}
