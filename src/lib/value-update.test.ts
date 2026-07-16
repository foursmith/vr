import { describe, expect, it } from "vitest"
import { resolveValueUpdate } from "./value-update"

describe("resolveValueUpdate", () => {
  it("resolves direct values and updater functions", () => {
    expect(resolveValueUpdate(2, 5)).toBe(5)
    expect(resolveValueUpdate(2, current => current * 3)).toBe(6)
  })
})
