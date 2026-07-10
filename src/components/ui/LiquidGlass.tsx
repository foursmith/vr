import { createEffect, createMemo, createSignal, createUniqueId } from 'solid-js'
import type { JSX } from '@solidjs/web'

type Vec2 = { x: number; y: number }
type LiquidGlassMode = 'shader'
type ClassValue = string | false | undefined | Array<string | false | undefined>

type LiquidGlassProps = {
  children: JSX.Element
  class?: ClassValue
  style?: JSX.CSSProperties | string
  ref?: (element: HTMLDivElement) => void
  onMouseEnter?: JSX.EventHandlerUnion<HTMLDivElement, MouseEvent>
  onMouseLeave?: JSX.EventHandlerUnion<HTMLDivElement, MouseEvent>
  onFocusIn?: JSX.EventHandlerUnion<HTMLDivElement, FocusEvent>
  onFocusOut?: JSX.EventHandlerUnion<HTMLDivElement, FocusEvent>
  displacementScale?: number
  blurAmount?: number
  saturation?: number
  aberrationIntensity?: number
  elasticity?: number
  cornerRadius?: number
  padding?: string
  overLight?: boolean
  active?: boolean
  castShadow?: boolean
  mode?: LiquidGlassMode
  mouseContainer?: () => HTMLElement | undefined
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

const smoothStep = (a: number, b: number, value: number) => {
  const t = clamp((value - a) / (b - a), 0, 1)
  return t * t * (3 - 2 * t)
}

const roundedRectSdf = (x: number, y: number, width: number, height: number, radius: number) => {
  const qx = Math.abs(x) - width + radius
  const qy = Math.abs(y) - height + radius
  return Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - radius
}

const liquidGlassFragment = (uv: Vec2): Vec2 => {
  const ix = uv.x - 0.5
  const iy = uv.y - 0.5
  const distanceToEdge = roundedRectSdf(ix, iy, 0.3, 0.2, 0.6)
  const displacement = smoothStep(0.8, 0, distanceToEdge - 0.15)
  const scaled = smoothStep(0, 1, displacement)
  return { x: ix * scaled + 0.5, y: iy * scaled + 0.5 }
}

const MAX_SHADER_MAP_DIMENSION = 256
const MAX_SHADER_MAP_PIXELS = 32_768
const MAX_SHADER_MAP_CACHE_ENTRIES = 32
const shaderMapCache = new Map<string, string>()

const fitShaderMapSize = (width: number, height: number) => {
  const sourceWidth = Math.max(1, Math.round(width))
  const sourceHeight = Math.max(1, Math.round(height))
  const dimensionScale = MAX_SHADER_MAP_DIMENSION / Math.max(sourceWidth, sourceHeight)
  const areaScale = Math.sqrt(MAX_SHADER_MAP_PIXELS / (sourceWidth * sourceHeight))
  const scale = Math.min(1, dimensionScale, areaScale)

  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale)),
  }
}

const generateShaderDisplacementMap = (width: number, height: number) => {
  const fittedSize = fitShaderMapSize(width, height)
  const w = fittedSize.width
  const h = fittedSize.height
  const cacheKey = `${w}x${h}`
  const cachedMap = shaderMapCache.get(cacheKey)
  if (cachedMap) return cachedMap

  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')

  if (!context) return ''

  canvas.width = w
  canvas.height = h

  let maxScale = 1
  const rawValues = new Float32Array(w * h * 2)
  let rawWriteIndex = 0

  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const uv = { x: x / w, y: y / h }
      const pos = liquidGlassFragment(uv)
      const dx = pos.x * w - x
      const dy = pos.y * h - y

      maxScale = Math.max(maxScale, Math.abs(dx), Math.abs(dy))
      rawValues[rawWriteIndex++] = dx
      rawValues[rawWriteIndex++] = dy
    }
  }

  const imageData = context.createImageData(w, h)
  const data = imageData.data
  let rawIndex = 0

  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const dx = rawValues[rawIndex++]
      const dy = rawValues[rawIndex++]
      const edgeDistance = Math.min(x, y, w - x - 1, h - y - 1)
      const edgeFactor = Math.min(1, edgeDistance / 2)
      const pixelIndex = (y * w + x) * 4

      data[pixelIndex] = clamp((dx * edgeFactor) / maxScale + 0.5, 0, 1) * 255
      data[pixelIndex + 1] = clamp((dy * edgeFactor) / maxScale + 0.5, 0, 1) * 255
      data[pixelIndex + 2] = data[pixelIndex + 1]
      data[pixelIndex + 3] = 255
    }
  }

  context.putImageData(imageData, 0, 0)
  const mapUrl = canvas.toDataURL('image/png')

  if (shaderMapCache.size >= MAX_SHADER_MAP_CACHE_ENTRIES) {
    const oldestKey = shaderMapCache.keys().next().value
    if (oldestKey) shaderMapCache.delete(oldestKey)
  }
  shaderMapCache.set(cacheKey, mapUrl)
  return mapUrl
}

export function LiquidGlass(props: LiquidGlassProps) {
  const filterId = createUniqueId()
  const edgeMaskId = `${filterId}-edge-mask`
  const [glassElement, setGlassElement] = createSignal<HTMLDivElement>()
  const [glassSize, setGlassSize] = createSignal({ width: 1, height: 1 })
  const [globalMousePos, setGlobalMousePos] = createSignal({ x: 0, y: 0 })
  const [shaderMapUrl, setShaderMapUrl] = createSignal('')

  const displacementScale = () => props.displacementScale ?? 56
  const blurAmount = () => props.blurAmount ?? 0.0625
  const saturation = () => props.saturation ?? 145
  const aberrationIntensity = () => props.aberrationIntensity ?? 2
  const elasticity = () => props.elasticity ?? 0.12
  const cornerRadius = () => props.cornerRadius ?? 24
  const overLight = () => props.overLight ?? false
  const active = () => props.active ?? false
  const castShadow = () => props.castShadow ?? true
  const isFirefox = typeof navigator !== 'undefined' && navigator.userAgent.toLowerCase().includes('firefox')

  const fadeInFactor = createMemo(() => {
    const mouse = globalMousePos()
    const element = glassElement()
    if (!mouse.x || !mouse.y || !element) return 0

    const rect = element.getBoundingClientRect()
    const edgeDistanceX = Math.max(0, Math.abs(mouse.x - (rect.left + rect.width / 2)) - glassSize().width / 2)
    const edgeDistanceY = Math.max(0, Math.abs(mouse.y - (rect.top + rect.height / 2)) - glassSize().height / 2)
    const edgeDistance = Math.hypot(edgeDistanceX, edgeDistanceY)
    const activationZone = 200

    return edgeDistance > activationZone ? 0 : 1 - edgeDistance / activationZone
  })

  const elasticTransform = createMemo(() => {
    const mouse = globalMousePos()
    const size = glassSize()
    const element = glassElement()
    if (!mouse.x || !mouse.y || !element) return 'translate3d(0, 0, 0) scale(1)'

    const rect = element.getBoundingClientRect()
    const centerX = rect.left + rect.width / 2
    const centerY = rect.top + rect.height / 2
    const deltaX = mouse.x - centerX
    const deltaY = mouse.y - centerY
    const centerDistance = Math.hypot(deltaX, deltaY)

    if (centerDistance === 0) return 'translate3d(0, 0, 0) scale(1)'

    const normalizedX = deltaX / centerDistance
    const normalizedY = deltaY / centerDistance
    const stretchIntensity = Math.min(centerDistance / 300, 1) * elasticity() * fadeInFactor()
    const scaleX = 1 + Math.abs(normalizedX) * stretchIntensity * 0.3 - Math.abs(normalizedY) * stretchIntensity * 0.15
    const scaleY = 1 + Math.abs(normalizedY) * stretchIntensity * 0.3 - Math.abs(normalizedX) * stretchIntensity * 0.15
    const x = deltaX * elasticity() * 0.1 * fadeInFactor()
    const y = deltaY * elasticity() * 0.1 * fadeInFactor()

    if (size.width <= 1 || size.height <= 1) return 'translate3d(0, 0, 0) scale(1)'
    return `translate3d(${x}px, ${y}px, 0) scaleX(${Math.max(0.8, scaleX)}) scaleY(${Math.max(0.8, scaleY)})`
  })

  const shellStyle = createMemo<JSX.CSSProperties>(() => ({
    'border-radius': `${cornerRadius()}px`,
    padding: props.padding ?? '0',
    transform: elasticTransform(),
    transition: 'transform 72ms ease-out',
  }))

  const updateMouse = (event: MouseEvent) => {
    setGlobalMousePos({ x: event.clientX, y: event.clientY })
  }

  createEffect(glassElement, (element) => {
    if (!element) return
    const updateSize = () => {
      const rect = element.getBoundingClientRect()
      const width = Math.max(1, Math.round(rect.width))
      const height = Math.max(1, Math.round(rect.height))
      setGlassSize((current) => (current.width === width && current.height === height ? current : { width, height }))
    }
    const resizeObserver = new ResizeObserver(updateSize)

    updateSize()
    resizeObserver.observe(element)
    window.addEventListener('resize', updateSize)

    return () => {
      resizeObserver.disconnect()
      window.removeEventListener('resize', updateSize)
    }
  })

  createEffect(
    () => props.mouseContainer?.() ?? glassElement(),
    (container) => {
      if (!container) return

      container.addEventListener('mouseenter', updateMouse)
      container.addEventListener('mousemove', updateMouse)
      return () => {
        container.removeEventListener('mouseenter', updateMouse)
        container.removeEventListener('mousemove', updateMouse)
      }
    },
  )

  createEffect(glassSize, (size) => {
    setShaderMapUrl(generateShaderDisplacementMap(size.width, size.height))
  })

  const setGlassRef = (element: HTMLDivElement) => {
    setGlassElement(element)
    props.ref?.(element)
  }

  return (
    <div
      ref={setGlassRef}
      class={['relative isolate overflow-visible', props.class]}
      style={props.style}
      onMouseEnter={props.onMouseEnter}
      onMouseLeave={props.onMouseLeave}
      onFocusIn={props.onFocusIn}
      onFocusOut={props.onFocusOut}
    >
      <svg class="pointer-events-none absolute left-0 top-0 h-0 w-0" aria-hidden="true" width={glassSize().width} height={glassSize().height}>
        <defs>
          <radialGradient id={edgeMaskId} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stop-color="black" stop-opacity="0" />
            <stop offset={`${Math.max(30, 80 - aberrationIntensity() * 2)}%`} stop-color="black" stop-opacity="0" />
            <stop offset="100%" stop-color="white" stop-opacity="1" />
          </radialGradient>
          <filter id={filterId} x="-35%" y="-35%" width="170%" height="170%" color-interpolation-filters="sRGB">
            <feImage x="0" y="0" width="100%" height="100%" result="DISPLACEMENT_MAP" href={shaderMapUrl()} preserveAspectRatio="none" />
            <feColorMatrix
              in="DISPLACEMENT_MAP"
              type="matrix"
              values="0.3 0.3 0.3 0 0 0.3 0.3 0.3 0 0 0.3 0.3 0.3 0 0 0 0 0 1 0"
              result="EDGE_INTENSITY"
            />
            <feComponentTransfer in="EDGE_INTENSITY" result="EDGE_MASK">
              <feFuncA type="discrete" tableValues={`0 ${aberrationIntensity() * 0.05} 1`} />
            </feComponentTransfer>
            <feOffset in="SourceGraphic" dx="0" dy="0" result="CENTER_ORIGINAL" />
            <feDisplacementMap in="SourceGraphic" in2="DISPLACEMENT_MAP" scale={displacementScale()} xChannelSelector="R" yChannelSelector="B" result="RED_DISPLACED" />
            <feColorMatrix in="RED_DISPLACED" type="matrix" values="1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0" result="RED_CHANNEL" />
            <feDisplacementMap
              in="SourceGraphic"
              in2="DISPLACEMENT_MAP"
              scale={displacementScale() * (1 - aberrationIntensity() * 0.05)}
              xChannelSelector="R"
              yChannelSelector="B"
              result="GREEN_DISPLACED"
            />
            <feColorMatrix in="GREEN_DISPLACED" type="matrix" values="0 0 0 0 0 0 1 0 0 0 0 0 0 0 0 0 0 0 1 0" result="GREEN_CHANNEL" />
            <feDisplacementMap
              in="SourceGraphic"
              in2="DISPLACEMENT_MAP"
              scale={displacementScale() * (1 - aberrationIntensity() * 0.1)}
              xChannelSelector="R"
              yChannelSelector="B"
              result="BLUE_DISPLACED"
            />
            <feColorMatrix in="BLUE_DISPLACED" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 0 0 0 1 0" result="BLUE_CHANNEL" />
            <feBlend in="GREEN_CHANNEL" in2="BLUE_CHANNEL" mode="screen" result="GB_COMBINED" />
            <feBlend in="RED_CHANNEL" in2="GB_COMBINED" mode="screen" result="RGB_COMBINED" />
            <feGaussianBlur in="RGB_COMBINED" stdDeviation={Math.max(0.1, 0.5 - aberrationIntensity() * 0.1)} result="ABERRATED_BLURRED" />
            <feComposite in="ABERRATED_BLURRED" in2="EDGE_MASK" operator="in" result="EDGE_ABERRATION" />
            <feComponentTransfer in="EDGE_MASK" result="INVERTED_MASK">
              <feFuncA type="table" tableValues="1 0" />
            </feComponentTransfer>
            <feComposite in="CENTER_ORIGINAL" in2="INVERTED_MASK" operator="in" result="CENTER_CLEAN" />
            <feComposite in="EDGE_ABERRATION" in2="CENTER_CLEAN" operator="over" />
          </filter>
        </defs>
      </svg>

      <div class="relative grid h-full w-full min-w-0 origin-center overflow-hidden will-change-transform" style={shellStyle()}>
        <span
          class="pointer-events-none absolute inset-0 z-0 rounded-[inherit]"
          style={{
            filter: isFirefox ? undefined : `url(#${filterId})`,
            '-webkit-backdrop-filter': `blur(${(overLight() ? 12 : 4) + blurAmount() * 32}px) saturate(${saturation()}%)`,
            'backdrop-filter': `blur(${(overLight() ? 12 : 4) + blurAmount() * 32}px) saturate(${saturation()}%)`,
          }}
        />
        <span
          class={[
            'pointer-events-none absolute inset-0 z-1 rounded-[inherit] transition-opacity',
            castShadow()
              ? 'shadow-[0_18px_60px_rgba(0,0,0,0.28),inset_0_1px_0_rgba(255,255,255,0.2)]'
              : 'shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]',
            active()
              ? 'bg-[linear-gradient(145deg,rgba(255,255,255,0.24),rgba(255,255,255,0.1)),rgba(255,255,255,0.18)]'
              : 'bg-[linear-gradient(145deg,rgba(255,255,255,0.14),rgba(255,255,255,0.045)),rgba(8,10,14,0.18)]',
          ]}
        />
        <div class="relative z-3 grid h-full w-full min-w-0 place-items-center">{props.children}</div>
      </div>
    </div>
  )
}
