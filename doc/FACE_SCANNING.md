# Face Scanning Algorithm

This document is the maintenance reference for face detection, recovery scanning, and adaptive inference scheduling in the VR player. Keep it synchronized with changes to the implementation files listed in [Maintenance contract](#maintenance-contract).

## Goals

The algorithm balances four competing goals:

1. Keep a tracked face comfortably framed in the portrait viewport with rotational and forward/backward camera motion.
2. Recover a face after it leaves the visible viewport without relying on distorted equirectangular crops.
3. Avoid running face inference faster than human motion or the detector requires.
4. Bound recovery cost so video rendering remains responsive on mobile hardware.

## Processing modes

The player alternates between two detection modes:

- **Viewport detection** copies the currently visible render into the reusable inference canvas. MediaPipe uses the short-range face detector while searching, then switches to the face landmarker after a reliable target is established. The landmarker supplies a feature-based center and head pose while it continues to see the target.
- **Panorama recovery** renders one perspective view of the sphere per inference. It starts after two consecutive viewport detections miss a face and continues until a face is found or all recovery tiles have been checked.

MediaPipe viewport search uses the BlazeFace short-range model, which is optimized for larger, nearby faces. A successful search enables the face landmarker on subsequent viewport samples. After the first detector or landmarker miss, the player retries the viewport with the detector; only a second consecutive viewport miss starts panorama recovery. Panorama recovery uses the full-range model because faces occupy fewer pixels in the wide-FOV scan tiles. The system face detector backend accepts the same scheduling choice but uses its platform-provided model and does not provide pose.

Only one inference may be in flight. The next inference time is measured from the start of the previous inference, with the completed capture and inference time subtracted from the remaining delay.

The reusable inference canvas is kept offscreen. When the debug panel is open, a separate visible preview shows every viewport inference frame. A viewport miss overlays **No face detected** on that current frame. During panorama recovery, missed recovery tiles stay offscreen and the preview keeps the latest missed viewport frame, so the scanner can continue searching without flashing panorama tiles through the debug UI. A successful viewport or panorama result replaces the preview with its inference frame and detected box.

## Recovery state machine

1. Viewport detection succeeds:
   - update the selected face and motion model;
   - clear the recovery tile index;
   - continue viewport tracking, using MediaPipe landmarks while the target remains reliable.
2. Viewport detection misses:
   - after the first consecutive miss, remain in viewport mode and retry once;
   - preserve the activity and adaptive frequency used by the missed inference for that retry;
   - after the second consecutive miss, remember the current camera yaw and pitch, reset the recovery tile index, and enter panorama recovery.
3. A recovery tile succeeds:
   - map its local face coordinates back to panorama coordinates;
   - create a panorama yaw/pitch target;
   - stop scanning and let the camera move toward the target.
4. A recovery tile misses:
   - advance to the next tile;
   - after the final tile, clear the viewport-miss counter and return to viewport detection before starting another recovery pass.

Only viewport misses count toward the two-miss recovery threshold; misses from individual panorama tiles do not. Any successful detection clears both miss counters. The target grace period and stable-face selection logic remain active across short misses so a single failed detection does not immediately discard the subject.

## Face pose

Once MediaPipe establishes a reliable viewport target, the face landmarker returns 478 normalized landmarks and a canonical-face transformation matrix. The player uses the eye and nose landmarks for the viewport center and decomposes the column-major 4×4 transformation matrix into signed YXZ Euler angles:

- `yaw` is rotation around the vertical Y axis;
- `pitch` is rotation around the horizontal X axis;
- `roll` is rotation around the forward Z axis.

The decomposition removes uniform scale from the matrix before reading the rotation and handles the YXZ gimbal-lock case by fixing roll to zero. Invalid, non-finite, or non-4×4 transforms are ignored.

Pitch contributes a bounded viewport-composition offset so the view follows the subject's vertical look direction. Pitch magnitude up to 6° is ignored. Beyond that dead zone, the offset grows linearly and reaches its maximum at 30°. Negative pitch (looking up) moves the target upward; positive pitch (looking down) moves it downward. The offset is capped at 12% of viewport height and passes through the existing 480 ms target smoothing. Because the viewport activation threshold is 8%, a sufficiently strong pitch can initiate vertical camera movement even when the face starts centered, while smaller pose changes remain inside the positional dead zone. Yaw and roll remain diagnostic only and do not affect camera motion. Pose never changes motion prediction, face identity selection, or panorama mapping.

The debug face-box label shows rounded signed degrees as `Y…° P…° R…°`. The system detector and panorama detector do not output pose, so their labels continue to show confidence only. A landmarker miss drops the unreliable landmark target and performs the single viewport detector retry before panorama recovery.

### Centering dead zones

Detection mode and camera movement share one hysteresis policy. From rest, a viewport target must drift beyond 8% of the inference view on either axis before the camera starts; after movement begins, it continues until both axes settle within 5%. A panorama recovery target similarly starts movement beyond 10° and settles within 7°. These same thresholds decide whether adaptive inference classifies a tracked target as `stable` or `active`, preventing scan frequency and render cadence from switching repeatedly near one boundary.

The dead zone is subtracted from larger errors so movement starts continuously at its edge. When an axis re-enters the dead zone, its residual camera velocity is cleared immediately; small detection jitter therefore cannot keep the render loop or camera moving.

### Camera motion profile

Camera speed increases continuously with the angular distance remaining outside the dead zone:

```text
speed = sign(offset) * maxSpeed * (1 - exp(-abs(offset) / distanceScale))
```

Viewport targets use a maximum speed of 18°/s and a 22° distance scale. Panorama recovery targets use a maximum speed of 32°/s and a 45° distance scale, allowing large recovery turns to travel decisively while close corrections stay gentle. Desired velocity is temporally smoothed with a 260 ms time constant, producing progressive acceleration and braking instead of an immediate speed jump.

### Forward and backward camera motion

Viewport detections use `sqrt(face.width * face.height)` as an approximate distance observation and target a normalized face size of `0.24`. This does not alter camera zoom or FOV. Instead, the camera translates along its current look direction. Positive `forward` values move toward the viewed projection surface and negative values move away.

The target assumes a local projection-surface distance of 100 units for spherical modes and 65 units for the flat screen, matching their geometry. Given the current forward position and observed face size, the remaining camera-to-surface distance is scaled by `observedSize / targetSize`. The resulting forward target is clamped to `[-35, 35]` units to limit panorama distortion. This is an approximate depth response inferred from apparent face size; the source video does not provide metric depth.

Forward motion starts outside a 3-unit dead zone and settles within 1.5 units. Its exponential velocity profile is capped at 16 units/s with an 18-unit distance scale, then passes through the same 260 ms temporal smoothing used by yaw and pitch. During panorama recovery capture, the camera temporarily returns to the projection center so perspective-to-panorama mapping remains valid, then restores the visible camera position.

### Projection-edge protection

Automatic movement on 180-degree projections checks the complete viewport against the video hemisphere before applying each yaw, pitch, or forward step. The check casts rays around all four viewport edges at quarter-edge intervals, intersects those rays with the projection surface, and measures each hit's signed spherical distance from the hemisphere boundary plane. Using plane distance rather than yaw is important near the poles, where the boundary appears curved in the viewport. Equirectangular modes use the 100-unit video sphere. Fisheye modes instead test the 99-unit back-half mask because its curved silhouette can occlude the outer video sphere first after the camera translates. A view is covered only when every sampled point remains inside the half-sphere with a 2° seam margin.

When a proposed step would cross the covered boundary, a binary search keeps the last covered fraction of that step and clears the blocked axis velocity. The camera can still move from an already exposed view toward better coverage, so a view left near an edge by manual control is not trapped there. Full 360-degree projections bypass this check. This protection uses the live camera FOV, zoom, viewport aspect, pitch, and forward position, rather than relying only on the older center-yaw clamp.

### Manual view override

Dragging the view, changing zoom, or explicitly resetting the view pauses face centering after the first effective change. The pause has no timeout: detections, recovery scanning, and camera motion remain stopped so the player does not undo the user's chosen view. Starting a gesture without moving does not pause centering. Resetting the view also returns the camera's forward position to the projection center.

While paused, the player shows a **Resume face centering** button. Resuming clears the manual override and schedules an immediate viewport detection. Disabling face centering or resetting the media also clears the override and hides the button.

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
- Consecutive detections are treated as a new subject when, within 1.5 seconds, center motion reaches `0.8` normalized image units per second and logarithmic apparent-size change reaches `1.2/s`. Both conditions must be present so fast translation or detector scale jitter alone does not discard identity continuity.
- A subject switch clears target smoothing, motion history, and accumulated camera velocity before tracking starts from the new face. This prevents the previous subject's position, distance, or motion from being blended into the new subject.
- The raw viewport face size also supplies the forward/backward camera target; the smoothed motion metrics remain dedicated to adaptive inference scheduling.
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

The first consecutive viewport miss does not immediately reclassify the retry as `searching`: its next deadline retains the activity, adaptive maximum frequency, motion adjustment, and processing headroom from the missed inference. If that retry also misses, panorama recovery begins and subsequent tile scans use the `recovery` schedule.

## Render cadence isolation

The configured playback render rate limits ordinary video presentation, but it does not limit camera interaction. While the user is dragging the view or face centering is moving the camera, rendering follows the display animation-frame cadence. Returning to ordinary playback starts a fresh playback deadline so an old deadline cannot delay the first settled frame.

## Debug metrics

The debug panel exposes the inputs needed for tuning:

- the movement hint presents each active axis as its own compact group: horizontal arrow plus angle, vertical arrow plus angle, and depth rings plus positional distance. Its screen position follows the active horizontal and vertical direction. Forward motion expands the cyan target ring around a fixed reference ring, while backward motion contracts it;

- current activity (`stable`, `active`, `searching`, or `recovery`);
- tracking frequency and inference duration;
- MediaPipe viewport face pose (`Y`, `P`, and `R`) on the debug face-box label when landmarks are available;
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
- `src/features/face-tracking/pose.ts`

Primary tests:

- `tests/unit/face-sampling.test.ts`
- `tests/unit/face-auto-center.test.ts`
- `tests/unit/frame-scheduler.test.ts`
- `tests/unit/face-pose.test.ts`

When changing the algorithm, update the relevant unit tests, run `bun run typecheck`, `bun run test`, and `bun run lint`, and verify that this document still describes the shipped constants and state transitions.
