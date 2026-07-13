import { onSettled } from "solid-js"
import {
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Vector2,
  WebGLRenderer,
} from "three"

const vertexShader = /* glsl */ `
  void main() {
    gl_Position = vec4(position, 1.0);
  }
`

const fragmentShader = /* glsl */ `
  precision mediump float;

  uniform float uTime;
  uniform vec2 uResolution;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
      mix(hash(i + vec2(0.0, 1.0)), hash(i + 1.0), f.x), f.y);
  }

  float fbm(vec2 p) {
    float value = 0.0;
    float amplitude = 0.5;
    for (int i = 0; i < 3; i++) {
      value += amplitude * noise(p);
      p = p * 2.03 + vec2(17.1, 9.2);
      amplitude *= 0.5;
    }
    return value;
  }

  void main() {
    vec2 uv = gl_FragCoord.xy / uResolution.xy;
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    float waterTime = uTime * 0.24;
    float rayTime = uTime * 0.65;
    vec2 waterUv = vec2((uv.x - 0.5) * aspect, uv.y);

    float current = fbm(waterUv * vec2(2.2, 2.8) + vec2(waterTime * 0.16, -waterTime * 0.1));
    float fineCurrent = noise(waterUv * vec2(5.5, 4.0) + vec2(-waterTime * 0.11, waterTime * 0.14));
    float depth = smoothstep(0.0, 1.0, uv.y);

    // Extend the icon's pale cyan lens into deeper ocean values instead of
    // shifting it toward murky green-black.
    vec3 deep = vec3(0.012, 0.105, 0.165);
    vec3 mid = vec3(0.025, 0.285, 0.390);
    vec3 surface = vec3(0.160, 0.650, 0.720);
    vec3 color = mix(deep, mid, pow(depth, 1.45));
    color = mix(color, surface, pow(depth, 5.0) * 0.48);
    color += (current - 0.5) * vec3(0.018, 0.055, 0.065);

    float rays = 0.0;
    for (int i = 0; i < 3; i++) {
      float fi = float(i);
      float origin = 0.16 + fi * 0.31 + sin(rayTime * (0.35 + fi * 0.03) + fi * 2.1) * 0.025;
      float depthFromSurface = 1.0 - uv.y;
      float slope = 0.14 + (fi - 1.0) * 0.055;
      float center = origin + slope * depthFromSurface;
      float width = 13.0 + fi * 2.7;
      rays += exp(-abs(uv.x - center) * width) * (0.7 + 0.3 * current);
    }
    rays *= smoothstep(0.02, 0.75, uv.y) * smoothstep(1.12, 0.62, uv.y);
    color += vec3(0.38, 0.81, 0.84) * rays * 0.14;

    vec2 causticUv = waterUv * vec2(8.0, 6.0);
    float waveA = abs(sin(causticUv.x + sin(causticUv.y * 0.74 + waterTime)));
    float waveB = abs(sin(causticUv.y * 1.17 - waterTime * 0.83 + sin(causticUv.x * 0.63)));
    float caustic = pow(max(0.0, 1.0 - min(waveA, waveB)), 5.0);
    caustic *= pow(depth, 6.0) * (0.45 + fineCurrent * 0.55);
    color += vec3(0.72, 0.95, 0.93) * caustic * 0.16;

    float vignette = 1.0 - smoothstep(0.28, 0.82, distance(uv, vec2(0.5, 0.54)));
    color *= 0.7 + vignette * 0.3;
    gl_FragColor = vec4(color, 1.0);
  }
`

export function OceanBackground() {
  let canvas!: HTMLCanvasElement

  onSettled(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    const renderer = new WebGLRenderer({
      canvas,
      antialias: false,
      powerPreference: "low-power",
      precision: "mediump",
    })
    const scene = new Scene()
    const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1)
    const geometry = new PlaneGeometry(2, 2)
    const uniforms = {
      uTime: { value: 0 },
      uResolution: { value: new Vector2(1, 1) },
    }
    const material = new ShaderMaterial({ vertexShader, fragmentShader, uniforms, depthTest: false, depthWrite: false })
    const plane = new Mesh(geometry, material)
    scene.add(plane)

    let renderTimer = 0
    let disposed = false
    let renderWidth = 0
    let renderHeight = 0
    const startedAt = performance.now()
    const frameInterval = 1000 / 12

    const draw = () => {
      const elapsed = (performance.now() - startedAt) / 1000
      uniforms.uTime.value = elapsed
      renderer.render(scene, camera)
    }

    const resize = () => {
      const width = Math.max(1, canvas.clientWidth)
      const height = Math.max(1, canvas.clientHeight)
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 0.65)
      const nextRenderWidth = Math.max(1, Math.floor(width * pixelRatio))
      const nextRenderHeight = Math.max(1, Math.floor(height * pixelRatio))
      if (nextRenderWidth === renderWidth && nextRenderHeight === renderHeight) return

      renderWidth = nextRenderWidth
      renderHeight = nextRenderHeight
      renderer.setPixelRatio(pixelRatio)
      renderer.setSize(width, height, false)
      uniforms.uResolution.value.set(nextRenderWidth, nextRenderHeight)
      draw()
    }

    const render = () => {
      if (disposed) return
      draw()
      if (!reducedMotion && !document.hidden) renderTimer = window.setTimeout(render, frameInterval)
    }

    const handleVisibility = () => {
      if (disposed || reducedMotion) return
      if (document.hidden) {
        window.clearTimeout(renderTimer)
        renderTimer = 0
      } else if (!renderTimer) {
        render()
      }
    }

    const resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(canvas)
    document.addEventListener("visibilitychange", handleVisibility)
    resize()
    render()

    return () => {
      disposed = true
      window.clearTimeout(renderTimer)
      resizeObserver.disconnect()
      document.removeEventListener("visibilitychange", handleVisibility)
      geometry.dispose()
      material.dispose()
      renderer.dispose()
    }
  })

  return <canvas ref={canvas} aria-hidden="true" class="pointer-events-none absolute inset-0 h-full w-full" />
}
