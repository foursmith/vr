import type { FacePose } from "./protocol"

interface FacialTransformationMatrix {
  rows: number
  columns: number
  data: number[]
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const toDegrees = (radians: number) => radians * 180 / Math.PI
const cleanAngle = (degrees: number) => Math.abs(degrees) < 0.05 ? 0 : degrees

// MediaPipe MatrixData is column-major. Extract YXZ Euler angles so yaw,
// pitch, and roll remain independently meaningful for a mostly upright face.
export const readFacePose = (matrix: FacialTransformationMatrix | undefined): FacePose | undefined => {
  if (!matrix || matrix.rows !== 4 || matrix.columns !== 4 || matrix.data.length !== 16) return undefined
  if (matrix.data.some(value => !Number.isFinite(value))) return undefined

  const data = matrix.data
  const scale = (
    Math.hypot(data[0], data[1], data[2])
    + Math.hypot(data[4], data[5], data[6])
    + Math.hypot(data[8], data[9], data[10])
  ) / 3
  if (scale < 1e-6) return undefined

  const m11 = data[0] / scale
  const m21 = data[1] / scale
  const m22 = data[5] / scale
  const m23 = data[9] / scale
  const m31 = data[2] / scale
  const m13 = data[8] / scale
  const m33 = data[10] / scale
  const pitch = Math.asin(-clamp(m23, -1, 1))
  const awayFromGimbalLock = Math.abs(m23) < 0.9999999
  const yaw = awayFromGimbalLock ? Math.atan2(m13, m33) : Math.atan2(-m31, m11)
  const roll = awayFromGimbalLock ? Math.atan2(m21, m22) : 0

  return {
    yaw: cleanAngle(toDegrees(yaw)),
    pitch: cleanAngle(toDegrees(pitch)),
    roll: cleanAngle(toDegrees(roll)),
  }
}
