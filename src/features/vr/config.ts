export const PRESETS = [
  { label: 'SBS 180 EQR', component: 'sbs_180_eqr' },
  { label: 'SBS 180 FE', component: 'sbs_180_fe' },
  { label: 'TB 360 EQR', component: 'tb_360_eqr' },
  { label: 'Flat 2D', component: 'flat_2d' },
  { label: 'Mono 180 EQR', component: 'm_180_eqr' },
  { label: 'Mono 360 EQR', component: 'mono_360_eqr' },
  { label: 'Mono 180 FE', component: 'm_180_fe' },
] as const

export const QUALITY_OPTIONS = [
  { label: 'Performance', component: 'performance', pixelRatio: 1 },
  { label: 'Balanced', component: 'balanced', pixelRatio: 1.5 },
  { label: 'Sharp', component: 'sharp', pixelRatio: 2 },
  { label: 'Ultra', component: 'ultra', pixelRatio: 2.5 },
] as const

export const DEFAULT_FOV = 80
export const DEFAULT_ZOOM = 1

export type ProjectionPreset = (typeof PRESETS)[number]['component']
export type ProjectionQuality = (typeof QUALITY_OPTIONS)[number]['component']

export type CameraView = {
  yaw: number
  pitch: number
  zoom: number
  pausedUntil: number
}
