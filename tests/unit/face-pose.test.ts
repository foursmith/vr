import { describe, expect, it } from "vitest"
import { readFacePose } from "../../src/features/face-tracking/pose"

const matrix = (data: number[]) => ({ rows: 4, columns: 4, data })
const identity = [
  1,
  0,
  0,
  0,
  0,
  1,
  0,
  0,
  0,
  0,
  1,
  0,
  0,
  0,
  0,
  1,
]

describe("face pose", () => {
  it("reads neutral pose from a column-major MediaPipe transform", () => {
    expect(readFacePose(matrix(identity))).toEqual({ yaw: 0, pitch: 0, roll: 0 })
  })

  it.each([
    ["yaw", 30, [
      Math.cos(Math.PI / 6),
      0,
      -Math.sin(Math.PI / 6),
      0,
      0,
      1,
      0,
      0,
      Math.sin(Math.PI / 6),
      0,
      Math.cos(Math.PI / 6),
      0,
      0,
      0,
      0,
      1,
    ]],
    ["pitch", 20, [
      1,
      0,
      0,
      0,
      0,
      Math.cos(Math.PI / 9),
      Math.sin(Math.PI / 9),
      0,
      0,
      -Math.sin(Math.PI / 9),
      Math.cos(Math.PI / 9),
      0,
      0,
      0,
      0,
      1,
    ]],
    ["roll", 15, [
      Math.cos(Math.PI / 12),
      Math.sin(Math.PI / 12),
      0,
      0,
      -Math.sin(Math.PI / 12),
      Math.cos(Math.PI / 12),
      0,
      0,
      0,
      0,
      1,
      0,
      0,
      0,
      0,
      1,
    ]],
  ] as const)("extracts %s rotation", (axis, degrees, data) => {
    const pose = readFacePose(matrix([...data]))!
    expect(pose[axis]).toBeCloseTo(degrees, 5)
  })

  it("rejects malformed transforms", () => {
    expect(readFacePose(matrix(identity.slice(0, 15)))).toBeUndefined()
    expect(readFacePose(matrix(identity.map((value, index) => index === 4 ? Number.NaN : value)))).toBeUndefined()
  })
})
