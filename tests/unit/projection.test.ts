import { Mesh, Texture } from "three"
import { describe, expect, it, vi } from "vitest"
import { PROJECTION_OPTIONS, projectionPixelRatio, QUALITY_OPTIONS } from "../../src/features/vr/config"
import { createProjectionGroup, disposeObject } from "../../src/features/vr/projection"

describe("vR projections", () => {
  it.each(PROJECTION_OPTIONS)("creates the $label projection", ({ component }) => {
    const video = { videoWidth: 1920, videoHeight: 1080 } as HTMLVideoElement
    const group = createProjectionGroup(video, new Texture() as never, component, "performance")
    expect(group.children.length).toBeGreaterThan(0)
    group.traverse((child) => {
      if (child instanceof Mesh) expect(child.geometry.attributes.position.count).toBeGreaterThan(0)
    })
    disposeObject(group)
  })

  it("keeps projection geometry stable across render quality changes", () => {
    const video = {} as HTMLVideoElement
    const counts = QUALITY_OPTIONS.map(({ component }) => {
      const group = createProjectionGroup(video, new Texture() as never, "mono_360_eqr", component)
      const count = (group.children[0] as Mesh).geometry.attributes.position.count
      disposeObject(group)
      return count
    })
    expect(new Set(counts).size).toBe(1)
  })

  it("applies visibly different render scales on standard and Retina displays", () => {
    const standard = QUALITY_OPTIONS.map(({ component }) => projectionPixelRatio(component, 1))
    const retina = QUALITY_OPTIONS.map(({ component }) => projectionPixelRatio(component, 2))
    expect(standard).toEqual([0.6, 0.8, 1, 1.1])
    expect(retina).toEqual([1.2, 1.6, 2, 2.2])
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
