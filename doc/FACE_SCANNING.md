# Face Scanning Algorithm

This document is the maintenance reference for face detection, recovery scanning, and adaptive inference scheduling in the VR player. Keep it synchronized with changes to the implementation files listed in [Maintenance contract](#maintenance-contract).

## Goals

The algorithm balances four competing goals:

1. Keep a tracked face comfortably framed in the portrait viewport.
2. Recover a face after it leaves the visible viewport without relying on distorted equirectangular crops.
3. Avoid running face inference faster than human motion or the detector requires.
4. Bound recovery cost so video rendering remains responsive on mobile hardware.

## Processing modes

The player alternates between two detection modes:

- **Viewport detection** copies the currently visible render into the reusable inference canvas. This is the normal tracking path.
- **Panorama recovery** renders one perspective view of the sphere per inference. It starts after viewport detection misses a face and continues until a face is found or all recovery tiles have been checked.

Only one inference may be in flight. The next inference time is measured from the start of the previous inference, with the completed capture and inference time subtracted from the remaining delay.

## Recovery state machine

1. Viewport detection succeeds:
   - update the selected face and motion model;
   - clear the recovery tile index;
   - continue viewport tracking.
2. Viewport detection misses:
   - remember the current camera yaw and pitch;
   - set the recovery tile index to zero;
   - enter panorama recovery.
3. A recovery tile succeeds:
   - map its local face coordinates back to panorama coordinates;
   - create a panorama yaw/pitch target;
   - stop scanning and let the camera move toward the target.
4. A recovery tile misses:
   - advance to the next tile;
   - after the final tile, return to viewport detection before starting another recovery pass.

The target grace period and stable-face selection logic remain active across short misses so a single failed detection does not immediately discard the subject.

## Perspective scan tiles

All spherical projections use five recovery tiles. Flat 2D content uses one view and does not require a sphere-wide scan.

### 360-degree projections

| Index | Yaw | Pitch | Vertical FOV | Purpose |
| ---: | --- | --- | ---: | --- |
| 0 | Lost-view yaw | Lost-view pitch, clamped to ±45° | 130° | Fast reacquisition near the last visible direction |
| 1 | Lost-view yaw + 120° | Same scan-ring pitch | 130° | First horizontal remainder |
| 2 | Lost-view yaw - 120° | Same scan-ring pitch | 130° | Second horizontal remainder |
| 3 | Lost-view yaw | +70° | 110° | Upper-cap fallback |
| 4 | Lost-view yaw | -70° | 110° | Lower-cap fallback |

Yaw wraps into `[-180°, 180°)`. The 130° horizontal FOV gives neighboring tiles overlap, reducing missed faces at tile boundaries.

### 180-degree projections

| Index | Yaw | Pitch | Vertical FOV | Purpose |
| ---: | ---: | --- | ---: | --- |
| 0 | Lost-view yaw, clamped to ±86° | Lost-view pitch, clamped to ±45° | 130° | Fast reacquisition |
| 1 | -60° | Same scan-ring pitch | 130° | Left half-sphere |
| 2 | +60° | Same scan-ring pitch | 130° | Right half-sphere |
| 3 | Lost-view yaw | +70° | 110° | Upper-cap fallback |
| 4 | Lost-view yaw | -70° | 110° | Lower-cap fallback |

## Capture path

For a recovery tile, the scene controller currently:

1. saves the visible camera projection and rotation;
2. changes the camera to a square perspective view for the selected tile;
3. renders the tile through the existing Three.js renderer;
4. copies the rendered square into the reusable 320-pixel inference canvas;
5. restores the visible camera in a `finally` block;
6. redraws the visible viewport or split-screen viewports.

This path favors compatibility and detector quality. It has an extra render cost during recovery. If it is replaced with a dedicated `WebGLRenderTarget`, update this document with the target size, color-space handling, readback path, vertical flip behavior, and disposal lifecycle.

## Perspective-to-panorama mapping

A detected face center in tile-normalized coordinates is converted to a camera-space ray:

```text
x = (2 * centerX - 1) * tan(fov / 2) * aspect
y = (1 - 2 * centerY) * tan(fov / 2)
z = -1
```

The normalized ray is rotated by the tile camera's `YXZ` Euler rotation. World-space yaw and pitch are then calculated from the ray. The result is normalized using a 360° or 180° yaw span as appropriate.

The face box width and height are converted to approximate angular dimensions. For 360° content, horizontal coordinates wrap across the panorama seam; for 180° content, they clamp to the valid half-sphere range.

## Motion model

Motion prediction is updated only from viewport detections, where consecutive coordinates share the same screen-space meaning.

- `size = sqrt(face.width * face.height)` approximates subject proximity.
- `speed` is the normalized face-center displacement per second.
- `recedingSpeed` is the decrease in `size` per second; positive values mean the subject appears to be moving away.
- Measurements use exponential smoothing with a 350 ms time constant.
- Motion history resets when the gap between reliable detections exceeds 1.5 seconds, media changes, playback pauses, tracking is disabled, or the scene becomes unavailable.

## Adaptive inference frequency

The base activity limits are:

| Activity | Maximum frequency | Meaning |
| --- | ---: | --- |
| `stable` | 3 Hz | Face is centered and the camera is settled |
| `active` | 6 Hz | Face is off-center or the camera is moving |
| `searching` | 8 Hz | No reliable target or recent viewport misses |
| `recovery` | 12 Hz | Perspective recovery tiles are being scanned |

Motion prediction further modifies `stable` and `active` modes:

- A close, slow subject uses 2 Hz when `size >= 0.18`, `speed < 0.08/s`, and `recedingSpeed < 0.015/s`.
- Movement urgency rises from zero to one as speed moves from `0.08/s` to `0.50/s`.
- Distance urgency rises from zero to one as receding speed moves from `0` to `0.15/s`.
- The larger urgency interpolates the mode limit toward 10 Hz, allowing the player to prepare before the face leaves the viewport.

The final period is:

```text
targetPeriod = 1000 / min(videoFrameRate, adaptiveMaxHz)
processingFloor = min(360 ms, inferenceP95 * activityHeadroom)
period = max(targetPeriod, processingFloor)
```

Activity headroom is 1.15 for stable, 1.10 for active, 1.08 for searching, and 1.03 for recovery.

## Debug metrics

The debug panel exposes the inputs needed for tuning:

- current activity (`stable`, `active`, `searching`, or `recovery`);
- tracking frequency and inference duration;
- `Motion`, normalized center speed per second;
- `Away`, positive receding speed per second;
- `Size`, normalized proximity estimate;
- capture duration and skipped inference frames.

Tune thresholds with representative videos and compare P95 values rather than a single fast desktop run.

## Maintenance contract

Changes to any of the following must update this document in the same change:

- scan tile count, order, yaw, pitch, FOV, or projection coverage;
- viewport/recovery state transitions;
- perspective capture or GPU readback behavior;
- perspective-to-panorama coordinate mapping;
- motion smoothing, proximity, movement, or recession calculations;
- activity states, frequency limits, thresholds, headroom, or P95 scheduling;
- debug metrics used to tune the algorithm.

Primary implementation files:

- `src/features/vr/face-sampling.ts`
- `src/features/vr/face-auto-center.ts`
- `src/features/vr/frame-scheduler.ts`
- `src/features/vr/scene.ts`

Primary tests:

- `tests/unit/face-sampling.test.ts`
- `tests/unit/face-auto-center.test.ts`
- `tests/unit/frame-scheduler.test.ts`

When changing the algorithm, update the relevant unit tests, run `bun run typecheck`, `bun run test`, and `bun run lint`, and verify that this document still describes the shipped constants and state transitions.
