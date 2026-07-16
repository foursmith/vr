import type { PerspectiveCamera } from "three"
import type { CameraView, ProjectionMode } from "../config"
import { constrainFaceAutoCenterView, getManualZoomForwardTarget } from "../tracking/face-center-movement"

export interface ManualViewInput {
  isInteracting: () => boolean
  adjustForward: (direction: number) => void
  destroy: () => void
}

interface CreateManualViewInputOptions {
  element: HTMLElement
  camera: PerspectiveCamera
  getView: () => CameraView
  getProjection: () => ProjectionMode
  getSurfaceDistance: () => number
  getViewportHeight: () => number
  isDebugEnabled: () => boolean
  onBoundaryWarning: (axis: "yaw" | "pitch" | "forward") => void
  onEffectiveViewChange: () => void
  requestRender: () => void
}

const WHEEL_ZOOM_SPEED = 0.0016
const TRACKPAD_PINCH_ZOOM_SPEED = 0.01
const KEYBOARD_ZOOM_SCALE = 1.1
const ROTATION_SPEED = 0.08

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

export const createManualViewInput = ({
  element,
  camera,
  getView,
  getProjection,
  getSurfaceDistance,
  getViewportHeight,
  isDebugEnabled,
  onBoundaryWarning,
  onEffectiveViewChange,
  requestRender,
}: CreateManualViewInputOptions): ManualViewInput => {
  const dragging = { active: false, pointerId: 0, x: 0, y: 0 }
  const touchPoints = new Map<number, { x: number, y: number }>()
  let pinch: { pointerIds: [number, number], distance: number, forward: number } | undefined

  const inspectProjectionBoundary = (axis: "yaw" | "pitch" | "forward", proposedValue: number) => {
    const current = getView()
    const proposed = { yaw: current.yaw, pitch: current.pitch, forward: current.forward, [axis]: proposedValue }
    const constrained = constrainFaceAutoCenterView(getProjection(), camera, current, proposed)
    const blocked = Math.abs(constrained[axis] - proposedValue) > 0.0001
    return { blocked, constrainedValue: constrained[axis] }
  }

  const applyManualAxis = (axis: "yaw" | "pitch" | "forward", proposedValue: number) => {
    const boundary = inspectProjectionBoundary(axis, proposedValue)
    if (isDebugEnabled() && boundary.blocked) onBoundaryWarning(axis)
    const appliedValue = isDebugEnabled() ? proposedValue : boundary.constrainedValue
    const view = getView()
    const changed = Math.abs(appliedValue - view[axis]) > 0.0001
    view[axis] = appliedValue
    return changed
  }

  const applyManualForward = (nextForward: number) => {
    if (nextForward === getView().forward) return
    if (!applyManualAxis("forward", nextForward)) return
    onEffectiveViewChange()
    requestRender()
  }

  const startTouchPinch = () => {
    const points = Array.from(touchPoints.entries()).slice(0, 2)
    if (points.length < 2) {
      pinch = undefined
      return
    }
    const [[firstId, first], [secondId, second]] = points
    pinch = {
      pointerIds: [firstId, secondId],
      distance: Math.max(1, Math.hypot(second.x - first.x, second.y - first.y)),
      forward: getView().forward,
    }
    dragging.active = false
  }

  const onPointerDown = (event: PointerEvent) => {
    if (event.pointerType === "mouse" && event.button !== 0) return
    if (event.pointerType === "touch") {
      touchPoints.set(event.pointerId, { x: event.clientX, y: event.clientY })
      element.setPointerCapture?.(event.pointerId)
      if (touchPoints.size > 1) {
        startTouchPinch()
      } else {
        dragging.active = true
        dragging.pointerId = event.pointerId
        dragging.x = event.clientX
        dragging.y = event.clientY
      }
      requestRender()
      return
    }
    dragging.active = true
    dragging.pointerId = event.pointerId
    dragging.x = event.clientX
    dragging.y = event.clientY
    element.setPointerCapture?.(event.pointerId)
    requestRender()
  }

  const onPointerMove = (event: PointerEvent) => {
    if (event.pointerType === "touch" && touchPoints.has(event.pointerId)) {
      touchPoints.set(event.pointerId, { x: event.clientX, y: event.clientY })
      if (pinch) {
        const [firstId, secondId] = pinch.pointerIds
        const first = touchPoints.get(firstId)
        const second = touchPoints.get(secondId)
        if (!first || !second) {
          startTouchPinch()
          return
        }
        const distance = Math.max(1, Math.hypot(second.x - first.x, second.y - first.y))
        applyManualForward(getManualZoomForwardTarget(
          pinch.forward,
          distance / pinch.distance,
          getSurfaceDistance(),
        ))
        return
      }
    }
    if (!dragging.active || dragging.pointerId !== event.pointerId) return
    if (event.pointerType === "mouse" && (event.buttons & 1) === 0) {
      dragging.active = false
      if (element.hasPointerCapture?.(event.pointerId)) element.releasePointerCapture?.(event.pointerId)
      requestRender()
      return
    }
    const dx = event.clientX - dragging.x
    const dy = event.clientY - dragging.y
    dragging.x = event.clientX
    dragging.y = event.clientY
    const nextYaw = getView().yaw + dx * ROTATION_SPEED
    const nextPitch = clamp(getView().pitch + dy * ROTATION_SPEED, -85, 85)
    const yawChanged = applyManualAxis("yaw", nextYaw)
    const pitchChanged = applyManualAxis("pitch", nextPitch)
    if (yawChanged || pitchChanged) onEffectiveViewChange()
    requestRender()
  }

  const onPointerUp = (event: PointerEvent) => {
    if (event.pointerType === "touch" && touchPoints.has(event.pointerId)) {
      touchPoints.delete(event.pointerId)
      if (element.hasPointerCapture?.(event.pointerId)) element.releasePointerCapture?.(event.pointerId)
      pinch = undefined
      if (touchPoints.size > 1) {
        startTouchPinch()
      } else {
        const remaining = touchPoints.entries().next().value as [number, { x: number, y: number }] | undefined
        dragging.active = Boolean(remaining)
        if (remaining) {
          dragging.pointerId = remaining[0]
          dragging.x = remaining[1].x
          dragging.y = remaining[1].y
        }
      }
      requestRender()
      return
    }
    if (!dragging.active || dragging.pointerId !== event.pointerId) return
    dragging.active = false
    if (element.hasPointerCapture?.(event.pointerId)) element.releasePointerCapture?.(event.pointerId)
    requestRender()
  }

  const onWheel = (event: WheelEvent) => {
    event.preventDefault()
    const deltaScale = event.deltaMode === WheelEvent.DOM_DELTA_LINE
      ? 16
      : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
        ? getViewportHeight()
        : 1
    const speed = event.ctrlKey ? TRACKPAD_PINCH_ZOOM_SPEED : WHEEL_ZOOM_SPEED
    applyManualForward(getManualZoomForwardTarget(
      getView().forward,
      Math.exp(-event.deltaY * deltaScale * speed),
      getSurfaceDistance(),
    ))
  }

  element.addEventListener("pointerdown", onPointerDown)
  element.addEventListener("pointermove", onPointerMove)
  element.addEventListener("pointerup", onPointerUp)
  element.addEventListener("pointercancel", onPointerUp)
  element.addEventListener("wheel", onWheel, { passive: false })

  return {
    isInteracting: () => dragging.active,
    adjustForward: direction => applyManualForward(getManualZoomForwardTarget(
      getView().forward,
      KEYBOARD_ZOOM_SCALE ** direction,
      getSurfaceDistance(),
    )),
    destroy() {
      element.removeEventListener("pointerdown", onPointerDown)
      element.removeEventListener("pointermove", onPointerMove)
      element.removeEventListener("pointerup", onPointerUp)
      element.removeEventListener("pointercancel", onPointerUp)
      element.removeEventListener("wheel", onWheel)
      touchPoints.clear()
      pinch = undefined
      dragging.active = false
    },
  }
}
