export interface FrameSchedule {
  render: boolean
  nextFrameAt?: number
}

export type FrameScheduleMode = "interaction" | "playback"

// Keep doc/PORTRAIT_CENTERING.md synchronized with inference activity and threshold changes.

const FRAME_DEADLINE_TOLERANCE_MS = 0.5
const INFERENCE_HEADROOM = 1.15
const INFERENCE_MAX_PERIOD_MS = 360

export type FaceInferenceActivity = "stable" | "active" | "searching" | "recovery"
export interface FaceMotionMetrics { size: number, speed: number, recedingSpeed: number }

const INFERENCE_ACTIVITY_CONFIG: Record<FaceInferenceActivity, { maxHz: number, headroom: number }> = {
  stable: { maxHz: 3, headroom: 1.15 },
  active: { maxHz: 6, headroom: 1.1 },
  searching: { maxHz: 8, headroom: 1.08 },
  recovery: { maxHz: 12, headroom: 1.03 },
}

export const faceInferencePeriod = (
  frameRate: number,
  inferenceP95: number,
  activity?: FaceInferenceActivity,
  motion?: FaceMotionMetrics,
) => {
  const config = activity ? INFERENCE_ACTIVITY_CONFIG[activity] : { maxHz: frameRate, headroom: INFERENCE_HEADROOM }
  let adaptiveMaxHz = config.maxHz
  if (activity === "stable" || activity === "active") {
    const isCloseAndSlow = motion
      && motion.size >= 0.18
      && motion.speed < 0.08
      && motion.recedingSpeed < 0.015
    if (isCloseAndSlow) {
      adaptiveMaxHz = 2
    } else if (motion) {
      const movementUrgency = Math.min(1, Math.max(0, (motion.speed - 0.08) / 0.42))
      const distanceUrgency = Math.min(1, Math.max(0, motion.recedingSpeed / 0.15))
      const urgency = Math.max(movementUrgency, distanceUrgency)
      adaptiveMaxHz += (10 - adaptiveMaxHz) * urgency
    }
  }
  const targetHz = Math.min(Math.max(1, frameRate), adaptiveMaxHz)
  return Math.max(
    1000 / targetHz,
    Math.min(INFERENCE_MAX_PERIOD_MS, inferenceP95 * config.headroom),
  )
}

export function scheduleFrame(
  now: number,
  frameRate: number,
  nextFrameAt?: number,
  mode: FrameScheduleMode = "playback",
): FrameSchedule {
  if (mode === "interaction") return { render: true }

  const interval = 1000 / Math.max(1, frameRate)
  if (nextFrameAt === undefined || !Number.isFinite(nextFrameAt)) {
    return { render: true, nextFrameAt: now + interval }
  }
  if (now < nextFrameAt - FRAME_DEADLINE_TOLERANCE_MS) {
    return { render: false, nextFrameAt }
  }

  let followingFrameAt = nextFrameAt + interval
  if (followingFrameAt <= now) {
    followingFrameAt += (Math.floor((now - followingFrameAt) / interval) + 1) * interval
  }
  return { render: true, nextFrameAt: followingFrameAt }
}
