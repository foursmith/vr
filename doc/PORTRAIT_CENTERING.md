# Portrait Centering

This document is the maintenance reference for portrait centering in the VR player. It covers face detection, target selection, recovery scanning, coordinate mapping, camera centering, motion prediction, and adaptive inference scheduling. It intentionally does not specify UI, controls, labels, debug panels, or visual presentation.

Keep it synchronized with changes to the implementation files listed in [Maintenance contract](#maintenance-contract).

## Goals

The system balances four goals:

1. Detect and continuously track the intended face.
2. Compose the portrait around the horizontal center and upper-third target of the viewport while following rotational and forward/backward motion.
3. Recover a face after it leaves the visible viewport without running detection directly on distorted equirectangular regions.
4. Adapt inference cost to subject motion while keeping video rendering responsive on mobile hardware.

## Processing pipeline

Only one inference may be in flight. Each inference follows this pipeline:

1. choose viewport detection or panorama recovery;
2. capture a perspective inference image;
3. run the selected detector or landmarker;
4. filter and select a face;
5. convert the result into viewport or panorama coordinates;
6. update the centering target and motion model;
7. schedule the next inference from the current activity and measured inference cost.

The next inference time is measured from the start of the previous inference. Completed capture and inference time is subtracted from the remaining delay.

## Face detection

### Detection modes and backends

The player alternates between two spatial detection modes:

- **Viewport detection** copies the currently rendered view into a reusable inference canvas. MediaPipe uses the BlazeFace short-range detector while searching because the viewport normally contains larger, nearby faces. After a reliable target is established, it uses the face landmarker to obtain a feature-based center and head pose.
- **Panorama recovery** renders one perspective view of the projection sphere per inference. It uses the MediaPipe full-range detector because a face occupies fewer pixels in a wide-FOV recovery tile.

A landmarker miss falls back to the viewport detector for the single viewport retry before recovery. Panorama recovery always uses face detection rather than landmarks.

### Face filtering and target selection

Detections are normalized face boxes. Candidates below confidence `0.5` are discarded. Remaining candidates receive a selection score composed of:

```text
selectionScore = confidence * 1.2
               + boxArea * 2.4
               + identityContinuity
               + directionContinuity
```

- `identityContinuity` contributes up to `1.6` for a candidate close to the previously selected face in the same detection mode. The contribution falls to zero at a normalized distance of `0.32`.
- `directionContinuity` favors candidates near the recovery direction anchor and falls to zero at a normalized distance of `0.42`; its maximum is supplied by the anchor weight.
- Horizontal distance wraps at the panorama seam in panorama mode.
- The previous face remains eligible as a continuity reference for 2.4 seconds.

This scoring favors a confident, prominent face without immediately switching subjects when another face briefly appears.

Within the same mode and a gap of at most 1.5 seconds, a new detection is classified as a different subject only when both center speed reaches `0.8` normalized image units per second and logarithmic apparent-size change reaches `1.2/s`. A subject switch clears target smoothing, motion history, and accumulated camera velocity before tracking the new face.

### Recovery state machine

1. A viewport detection succeeds:
   - update the selected face, centering target, and motion model;
   - clear the recovery tile index and miss counters;
   - continue viewport tracking, using MediaPipe landmarks while the target remains reliable.
2. A viewport detection misses:
   - after the first consecutive miss, stay in viewport mode and retry with the detector;
   - preserve the activity and adaptive frequency used by the missed inference for that retry;
   - after the second consecutive miss, store the current camera yaw and pitch, reset the recovery tile index, and enter panorama recovery.
3. A recovery tile succeeds:
   - map the local face coordinates back to panorama coordinates;
   - create a panorama yaw/pitch target;
   - stop scanning and move the camera toward that target.
4. A recovery tile misses:
   - advance to the next tile;
   - after the final tile, clear the viewport-miss counter and return to viewport detection before another recovery pass.

Only viewport misses count toward the two-miss recovery threshold. A successful detection clears both miss counters. Face continuity remains active across short misses so one failed inference does not immediately discard the subject.

### Face pose

After MediaPipe establishes a reliable viewport target, the face landmarker returns 478 normalized landmarks and a canonical-face transformation matrix. The player uses the eye and nose landmarks for the viewport center and decomposes the column-major 4×4 matrix into signed YXZ Euler angles:

- `yaw` is rotation around the vertical Y axis;
- `pitch` is rotation around the horizontal X axis;
- `roll` is rotation around the forward Z axis.

The decomposition removes uniform scale before reading rotation and handles the YXZ gimbal-lock case by fixing roll to zero. Invalid, non-finite, or non-4×4 transforms are ignored.

Pitch adjusts vertical composition. Magnitudes up to 6° are ignored. Beyond that dead zone, the offset grows linearly and reaches its maximum at 30°. Negative pitch moves the target upward and positive pitch moves it downward. The offset is capped at 12% of viewport height and passes through the normal 480 ms target smoothing. Yaw and roll are diagnostic data only; they do not affect centering, motion prediction, face identity selection, or panorama mapping.

## Detection capture and recovery scan

### Perspective scan tiles

All spherical projections use five recovery tiles. Flat 2D content uses one view and does not require a sphere-wide scan.

#### 360-degree projections

| Index | Yaw | Pitch | Vertical FOV | Purpose |
| ---: | --- | --- | ---: | --- |
| 0 | Lost-view yaw | Lost-view pitch, clamped to ±45° | 130° | Reacquire near the last visible direction |
| 1 | Lost-view yaw + 120° | Same scan-ring pitch | 130° | First horizontal remainder |
| 2 | Lost-view yaw - 120° | Same scan-ring pitch | 130° | Second horizontal remainder |
| 3 | Lost-view yaw | +70° | 110° | Upper-cap fallback |
| 4 | Lost-view yaw | -70° | 110° | Lower-cap fallback |

Yaw wraps into `[-180°, 180°)`. The 130° horizontal FOV overlaps neighboring tiles to reduce misses at tile boundaries.

#### 180-degree projections

| Index | Yaw | Pitch | Vertical FOV | Purpose |
| ---: | ---: | --- | ---: | --- |
| 0 | Lost-view yaw, clamped to ±86° | Lost-view pitch, clamped to ±45° | 130° | Reacquire near the last visible direction |
| 1 | -60° | Same scan-ring pitch | 130° | Left half-sphere |
| 2 | +60° | Same scan-ring pitch | 130° | Right half-sphere |
| 3 | Lost-view yaw | +70° | 110° | Upper-cap fallback |
| 4 | Lost-view yaw | -70° | 110° | Lower-cap fallback |

### Capture path

For a recovery tile, the scene controller:

1. saves the visible camera projection, rotation, and forward position;
2. returns the camera to the projection center and configures a square perspective view for the tile;
3. renders the tile through the existing Three.js renderer;
4. copies the rendered square into the reusable 320-pixel inference canvas;
5. restores the visible camera in a `finally` block;
6. redraws the visible viewport or split-screen viewports.

Returning to the projection center keeps perspective-to-panorama mapping valid when the visible camera has moved forward or backward. This path favors compatibility and detector quality at the cost of an extra render during recovery. If replaced with a dedicated `WebGLRenderTarget`, document the target size, color-space handling, readback path, vertical flip behavior, and disposal lifecycle.

### Perspective-to-panorama mapping

A detected face center in tile-normalized coordinates is converted to a camera-space ray:

```text
x = (2 * centerX - 1) * tan(fov / 2) * aspect
y = (1 - 2 * centerY) * tan(fov / 2)
z = -1
```

The normalized ray is rotated by the tile camera's `YXZ` Euler rotation. World-space yaw and pitch are calculated from the ray and normalized using a 360° or 180° yaw span.

The face box width and height are converted to approximate angular dimensions. Horizontal coordinates wrap across the seam for 360° content and clamp to the valid half-sphere for 180° content.

## Portrait centering algorithm

### Composition target and smoothing

Viewport centering targets normalized position `(0.5, 1/3)`: horizontally centered, with the face center on the upper third of the frame. Panorama recovery results are converted into yaw and pitch that place the recovered face at the same composition target.

Position, panorama angle, and forward targets use exponential smoothing with a 480 ms time constant. Smoothing resets when the detection mode changes, the target gap exceeds 1.8 seconds, or a subject switch is detected.

### Centering dead zones

Detection activity and camera movement share one hysteresis policy:

- From rest, a viewport target must drift beyond 8% of the inference view on either axis before movement starts. Movement continues until both axes settle within 5%.
- A panorama target starts movement beyond 10° and settles within 7°.
- Forward movement starts outside 3 units and settles within 1.5 units.

The dead zone is subtracted from larger errors so velocity starts continuously at its edge. When an axis re-enters its dead zone, residual velocity on that axis is cleared immediately. The same positional thresholds classify the tracked target as `stable` or `active` for inference scheduling.

### Rotational camera motion

Camera speed increases continuously with the angular distance outside the dead zone:

```text
speed = sign(offset) * maxSpeed * (1 - exp(-abs(offset) / distanceScale))
```

Viewport targets use a maximum speed of 18°/s and a 22° distance scale. Panorama targets use a maximum speed of 32°/s and a 45° distance scale. Desired velocity is temporally smoothed with a 260 ms time constant to provide progressive acceleration and braking.

### Forward and backward camera motion

Viewport detections use `sqrt(face.width * face.height)` as an approximate distance observation and target a normalized face size of `0.24`. The camera translates along its current look direction instead of changing zoom or FOV. Positive `forward` values move toward the projection surface; negative values move away.

The target assumes a local projection-surface distance of 100 units for spherical modes and 65 units for the flat screen. Given the current forward position and observed face size, the remaining camera-to-surface distance is scaled by `observedSize / targetSize`. The result is clamped to `[-35, 35]` units. This is an approximate depth response inferred from apparent face size; the source video does not provide metric depth.

Forward velocity uses the same exponential profile, capped at 16 units/s with an 18-unit distance scale, and the same 260 ms temporal velocity smoothing as yaw and pitch.

Manual zoom inputs use the same forward/backward camera axis instead of changing camera zoom or FOV. Pinch distance, wheel deltas, and keyboard steps are converted to a multiplicative scale, then applied to the remaining camera-to-surface distance:

```text
forwardTarget = surfaceDistance - (surfaceDistance - currentForward) / scale
```

Keyboard zoom uses a scale factor of `1.1` per step. Manual movement does not use the automatic centering range of `[-35, 35]`: increasing scale approaches the projection surface asymptotically without crossing it, while decreasing scale can move away without an artificial backward limit. Normally, half-sphere boundary protection still constrains manual movement. When Debug is open, manual boundary blocking is disabled and a visible warning is emitted instead, allowing sufficiently large movement to expose areas outside the video. The perspective camera remains at zoom `1` with its configured FOV.

### Projection-edge protection and debug monitoring

Movement on 180-degree projections checks the complete viewport against the video hemisphere for each monitored yaw, pitch, or forward step. Rays are cast around all four viewport edges at quarter-edge intervals, intersected with the projection surface, and measured against the hemisphere boundary plane. Plane distance is used instead of yaw because the boundary appears curved near the poles.

Equirectangular modes use the 100-unit video sphere. Fisheye modes use the 99-unit back-half mask because its curved silhouette can occlude the outer video sphere first after camera translation. A view is covered only when every sampled point remains inside the half-sphere with a 2° seam margin.

If a proposed automatic-centering step crosses the boundary, a binary search keeps the last covered fraction and clears the blocked axis velocity. This automatic protection is always active, including while Debug is open. For manual movement only, Debug applies the original proposed step unchanged and emits a visible `Projection boundary · <axis> (not blocked)` warning where protection would otherwise intervene. Full 360-degree projections bypass this check.

### Manual override state

An effective manual rotation, forward/backward change, or view reset pauses detection, recovery scanning, and camera motion with no timeout. Starting an interaction without changing the view does not pause centering. A view reset also returns the camera to the projection center. Resuming clears the override and schedules an immediate viewport detection. Disabling centering or resetting the media also clears the override.

This section defines state behavior only; the UI used to expose these actions is outside this document's scope.

## Motion model

Motion prediction is updated only from viewport detections, where consecutive coordinates share the same screen-space meaning.

- `size = sqrt(face.width * face.height)` approximates subject proximity.
- `speed` is normalized face-center displacement per second.
- `recedingSpeed` is the decrease in `size` per second; positive values mean the subject appears to be moving away.
- Measurements use exponential smoothing with a 350 ms time constant.
- The raw viewport face size supplies the forward/backward target; smoothed metrics are used only for adaptive inference scheduling.
- Motion history resets after a reliable-detection gap longer than 1.5 seconds, a subject switch, media changes, playback pause, disabled centering, or loss of the scene.

## Adaptive inference scheduling

The base activity limits are:

| Activity | Maximum frequency | Meaning |
| --- | ---: | --- |
| `stable` | 3 Hz | Face is composed and the camera is settled |
| `active` | 6 Hz | Face is outside the dead zone or the camera is moving |
| `searching` | 8 Hz | No reliable target or repeated viewport misses |
| `recovery` | 12 Hz | Perspective recovery tiles are being scanned |

Motion prediction further modifies `stable` and `active` modes:

- A close, slow subject uses 2 Hz when `size >= 0.18`, `speed < 0.08/s`, and `recedingSpeed < 0.015/s`.
- Movement urgency rises from zero to one as speed moves from `0.08/s` to `0.50/s`.
- Distance urgency rises from zero to one as receding speed moves from `0` to `0.15/s`.
- The larger urgency interpolates the activity limit toward 10 Hz.

The final period is:

```text
targetPeriod = 1000 / min(videoFrameRate, adaptiveMaxHz)
processingFloor = min(360 ms, inferenceP95 * activityHeadroom)
period = max(targetPeriod, processingFloor)
```

Activity headroom is 1.15 for `stable`, 1.10 for `active`, 1.08 for `searching`, and 1.03 for `recovery`.

The first viewport miss preserves the missed inference's activity, adaptive maximum frequency, motion adjustment, and processing headroom for the detector retry. If the retry also misses, panorama recovery begins and subsequent tile scans use the `recovery` schedule.

## Render cadence isolation

The configured playback render rate limits ordinary video presentation but does not limit camera interaction. While manual interaction or portrait centering moves the camera, rendering follows display animation-frame cadence. Returning to ordinary playback starts a fresh playback deadline so an old deadline cannot delay the first settled frame.

## Maintenance contract

Changes to any of the following must update this document in the same change:

- face detector or landmarker selection, confidence filtering, or target selection;
- viewport/recovery state transitions;
- scan tile count, order, yaw, pitch, FOV, or projection coverage;
- perspective capture or GPU readback behavior;
- perspective-to-panorama coordinate mapping;
- composition target, pose adjustment, target smoothing, dead zones, or camera motion;
- forward/backward estimation or projection-edge protection;
- motion smoothing, proximity, movement, recession, or subject-switch calculations;
- activity states, frequency limits, thresholds, headroom, or P95 scheduling.

Primary implementation files:

- `src/features/vr/face-sampling.ts`
- `src/features/vr/face-auto-center.ts`
- `src/features/vr/frame-scheduler.ts`
- `src/features/vr/scene.ts`
- `src/features/face-tracking/pose.ts`

Primary tests:

- `tests/unit/face-sampling.test.ts`
- `tests/unit/face-auto-center.test.ts`
- `tests/unit/frame-scheduler.test.ts`
- `tests/unit/face-pose.test.ts`

When changing the algorithm, update the relevant unit tests, run `bun run typecheck`, `bun run test`, and `bun run lint`, and verify that this document still describes the shipped constants and state transitions.
