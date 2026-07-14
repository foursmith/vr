export const PROJECTION_OPTIONS = [
  { label: "SBS 180 EQR", component: "sbs_180_eqr" },
  { label: "SBS 180 FE", component: "sbs_180_fe" },
  { label: "TB 360 EQR", component: "tb_360_eqr" },
  { label: "Flat 2D", component: "flat_2d" },
  { label: "Mono 180 EQR", component: "m_180_eqr" },
  { label: "Mono 360 EQR", component: "mono_360_eqr" },
  { label: "Mono 180 FE", component: "m_180_fe" },
] as const

export const QUALITY_OPTIONS = [
  { label: "Performance", component: "performance", pixelRatioScale: 0.6 },
  { label: "Balanced", component: "balanced", pixelRatioScale: 0.8 },
  { label: "Sharp", component: "sharp", pixelRatioScale: 1 },
  { label: "Ultra", component: "ultra", pixelRatioScale: 1.1 },
] as const

export const DEFAULT_FOV = 80
export const DEFAULT_ZOOM = 1

export type ProjectionMode = (typeof PROJECTION_OPTIONS)[number]["component"]
export type ProjectionQuality = (typeof QUALITY_OPTIONS)[number]["component"]

export const projectionPixelRatio = (quality: ProjectionQuality, devicePixelRatio: number) => {
  const scale = QUALITY_OPTIONS.find(option => option.component === quality)?.pixelRatioScale ?? 1
  return Math.min(4, Math.max(0.5, devicePixelRatio * scale))
}

export interface CameraView {
  yaw: number
  pitch: number
  zoom: number
  pausedUntil: number
}
