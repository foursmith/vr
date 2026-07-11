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

    vec3 deep = vec3(0.008, 0.035, 0.046);
    vec3 mid = vec3(0.018, 0.105, 0.125);
    vec3 surface = vec3(0.055, 0.24, 0.27);
    vec3 color = mix(deep, mid, pow(depth, 1.45));
    color = mix(color, surface, pow(depth, 5.0) * 0.48);
    color += (current - 0.5) * vec3(0.008, 0.025, 0.028);

    float rays = 0.0;
    for (int i = 0; i < 5; i++) {
      float fi = float(i);
      float origin = 0.12 + fi * 0.19 + sin(rayTime * (0.35 + fi * 0.03) + fi * 2.1) * 0.025;
      float slope = (fi - 2.0) * 0.035;
      float center = origin + slope * (1.0 - uv.y);
      float width = 13.0 + fi * 2.7;
      rays += exp(-abs(uv.x - center) * width) * (0.7 + 0.3 * current);
    }
    rays *= smoothstep(0.02, 0.75, uv.y) * smoothstep(1.12, 0.62, uv.y);
    color += vec3(0.09, 0.24, 0.25) * rays * 0.12;

    vec2 causticUv = waterUv * vec2(8.0, 6.0);
    float waveA = abs(sin(causticUv.x + sin(causticUv.y * 0.74 + waterTime)));
    float waveB = abs(sin(causticUv.y * 1.17 - waterTime * 0.83 + sin(causticUv.x * 0.63)));
    float caustic = pow(max(0.0, 1.0 - min(waveA, waveB)), 5.0);
    caustic *= pow(depth, 6.0) * (0.45 + fineCurrent * 0.55);
    color += vec3(0.18, 0.48, 0.48) * caustic * 0.14;

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
    const startedAt = performance.now()
    const frameInterval = 1000 / 12
    const root = canvas.parentElement

    const resize = () => {
      const width = Math.max(1, canvas.clientWidth)
      const height = Math.max(1, canvas.clientHeight)
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 0.65)
      renderer.setPixelRatio(pixelRatio)
      renderer.setSize(width, height, false)
      uniforms.uResolution.value.set(width * pixelRatio, height * pixelRatio)
    }

    const render = () => {
      if (disposed) return
      const elapsed = (performance.now() - startedAt) / 1000
      uniforms.uTime.value = elapsed
      if (!reducedMotion && root) {
        const rayTime = elapsed * 0.65
        root.style.setProperty("--ocean-flow-x", `${Math.sin(rayTime * 0.41 + 2.1) * 18}px`)
        root.style.setProperty("--ocean-flow-y", `${Math.sin(rayTime * 0.27 - 0.8) * 8}px`)
      }
      renderer.render(scene, camera)
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
      root?.style.removeProperty("--ocean-flow-x")
      root?.style.removeProperty("--ocean-flow-y")
      geometry.dispose()
      material.dispose()
      renderer.dispose()
    }
  })

  return <canvas ref={canvas} aria-hidden="true" class="pointer-events-none absolute inset-0 h-full w-full" />
}
