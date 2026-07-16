export interface FrameSchedule {
  render: boolean
  nextFrameAt?: number
}

export type FrameScheduleMode = "interaction" | "playback"

const FRAME_DEADLINE_TOLERANCE_MS = 0.5

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
