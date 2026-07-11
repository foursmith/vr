import { Mesh, Texture } from "three"
import { describe, expect, it, vi } from "vitest"
import { PRESETS, QUALITY_OPTIONS } from "../../src/features/vr/config"
import { createProjectionGroup, disposeObject } from "../../src/features/vr/projection"

describe("vR projections", () => {
  it.each(PRESETS)("creates the $label projection", ({ component }) => {
    const video = { videoWidth: 1920, videoHeight: 1080 } as HTMLVideoElement
    const group = createProjectionGroup(video, new Texture() as never, component, "performance")
    expect(group.children.length).toBeGreaterThan(0)
    group.traverse((child) => {
      if (child instanceof Mesh) expect(child.geometry.attributes.position.count).toBeGreaterThan(0)
    })
    disposeObject(group)
  })

  it("increases equirectangular geometry detail with quality", () => {
    const video = {} as HTMLVideoElement
    const counts = QUALITY_OPTIONS.map(({ component }) => {
      const group = createProjectionGroup(video, new Texture() as never, "mono_360_eqr", component)
      const count = (group.children[0] as Mesh).geometry.attributes.position.count
      disposeObject(group)
      return count
    })
    expect(counts).toEqual([...counts].sort((a, b) => a - b))
    expect(new Set(counts).size).toBe(counts.length)
  })

  it("disposes geometries and materials", () => {
    const group = createProjectionGroup({} as HTMLVideoElement, new Texture() as never, "flat_2d", "performance")
    const meshes = group.children as Mesh[]
    const geometrySpies = meshes.map(mesh => vi.spyOn(mesh.geometry, "dispose"))
    const materialSpies = meshes.map(mesh => vi.spyOn(mesh.material as { dispose: () => void }, "dispose"))
    disposeObject(group)
    geometrySpies.forEach(spy => expect(spy).toHaveBeenCalledOnce())
    materialSpies.forEach(spy => expect(spy).toHaveBeenCalledOnce())
  })
})
