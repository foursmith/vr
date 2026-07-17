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
3. run the selected face detector;
4. filter and select a face;
5. convert the result into viewport or panorama coordinates;
6. update the centering target and motion model;
7. schedule the next inference from the current activity and measured inference cost.

The next inference time is measured from the start of the previous inference. Completed capture and inference time is subtracted from the remaining delay.

## Face detection

### Detection modes and backends

The player alternates between two spatial detection modes:

- **Viewport detection** copies the currently rendered view into a reusable inference canvas. The `tracking` state uses the BlazeFace short-range detector. Its first miss enters `viewport-retry`, which applies the full-range detector to the same rendered view; a second miss creates the panorama scan plan.
- **Panorama recovery** renders one perspective view of the projection sphere per inference. It uses the MediaPipe full-range detector because a face occupies fewer pixels in a wide-FOV recovery tile.

After video playback enters `playing`, the player starts a non-blocking background prefetch of the MediaPipe WASM loader, WASM binary, short-range model, and full-range model. Playback and the first visible frame do not wait for this work. Repeated `playing` events share the same in-session prefetch, failed prefetches remain retryable, and detector instances are still created lazily by the first inference that needs each range.

Detector backends in the same page lease one shared tracker client. Releasing one player destroys only its lease; the shared worker and detector instances remain alive until the final active backend releases them. Explicit application-level resource release still tears down the shared client and clears all leases.

### Face filtering and target selection

Detections are normalized face boxes. MediaPipe detection and automatic-centering candidate selection share a minimum confidence of `0.6`; candidates below it are discarded. Remaining candidates receive a selection score composed of:

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

Detection acquisition is owned by `FaceScanController` through one discriminated `FaceDetectionState`. The scene composition root does not keep parallel recovery flags, viewport-miss counters, scan references, or retry timestamps.

| State | Capture and detector | Success | Miss or completion |
| --- | --- | --- | --- |
| `tracking` | Rendered viewport, short range | Update viewport target and remain in `tracking` | Enter `viewport-retry`; preserve the missed inference's activity and period |
| `viewport-retry` | Rendered viewport, full range | Update viewport target and return to `tracking` | Freeze the motion prediction, build and order the recovery tiles, then enter `panorama-scan` |
| `panorama-scan` | Active perspective tile, full range | Accept a reliable mapped candidate, create its panorama target, and return to `tracking` | Insert the pass's single refinement when eligible; otherwise advance the coarse scan |
| `recovery-backoff` | No capture before `retryAt` | — | When due, return to `tracking` for a fresh short-range viewport attempt |

An unreliable panorama candidate may insert one 70° refinement tile centered on its mapped direction. A failed or still-unreliable refinement advances past its originating coarse tile. This limits a 360° pass to seven inferences and a 180° pass to six. Exhausting all coarse tiles enters `recovery-backoff`: measured from completion of the final failed inference, the first failed pass waits 500 ms and consecutive failures double the delay up to 4 seconds. Any successful viewport or panorama detection creates a fresh `tracking` state and clears accumulated misses, scan progress, failed-pass count, and backoff.

A reliable panorama direction that cannot be reached without exposing a 180-degree projection edge requests the nearest inward camera position that restores coverage. The camera moves inward while aligning the target; a later viewport detection supplies the fresh face size and normal depth target. Face identity continuity remains active across short misses, while the state machine's total miss count controls when a stale selected subject is discarded.

## Detection capture and recovery scan

### Perspective scan tiles

Full-sphere projections use six coarse recovery tiles; half-sphere projections use five. Every coarse tile is a square 100° perspective view. This is a cubemap-like layout with 10° overlap between adjacent nominal 90° faces. Compared with the previous 130° tiles, it substantially reduces rectilinear edge stretching and makes a face occupy more pixels in the fixed 320×320 detector input. Flat 2D content uses one view and does not require a sphere-wide scan. The tables define the coverage set, not its runtime order.

#### 360-degree projections

| Candidate | Yaw | Pitch | Vertical FOV | Purpose |
| ---: | --- | --- | ---: | --- |
| 0 | Lost-view yaw | 0° | 100° | First equatorial face |
| 1 | Lost-view yaw + 90° | 0° | 100° | Second equatorial face |
| 2 | Lost-view yaw + 180° | 0° | 100° | Third equatorial face |
| 3 | Lost-view yaw - 90° | 0° | 100° | Fourth equatorial face |
| 4 | Lost-view yaw | +90° | 100° | Upper polar face |
| 5 | Lost-view yaw | -90° | 100° | Lower polar face |

Yaw wraps into `[-180°, 180°)`. The lost-view yaw rotates the whole six-face layout without changing its coverage.

#### 180-degree projections

| Candidate | Yaw | Pitch | Vertical FOV | Purpose |
| ---: | ---: | --- | ---: | --- |
| 0 | 0° | 0° | 100° | Center of the half-sphere |
| 1 | -60° | 0° | 100° | Left side |
| 2 | +60° | 0° | 100° | Right side |
| 3 | 0° | +90° | 100° | Upper polar face |
| 4 | 0° | -90° | 100° | Lower polar face |

The half-sphere layout is fixed to the projection rather than the lost view. This prevents a near-edge lost view from leaving an uncovered gap around the center of the 180° source.

### Motion-prioritized order

Before a recovery pass, the player projects the last reliable viewport face into world yaw and pitch, predicts its direction at the expected first scan time, and sorts the fixed five- or six-tile coverage set by spherical angular distance to that prediction. The ordered plan is frozen for the pass so asynchronous results cannot reshuffle tiles in flight.

The prediction uses the last world-direction velocity, the age of that observation, and a 160 ms scan lead. Total extrapolation time is capped at 600 ms, yaw extrapolation at 45°, and pitch extrapolation at 30°. Direction history must contain at least two samples and be no older than 900 ms. Predictions wrap across the 360° seam, clamp to ±86° yaw for half-sphere projections, and clamp to ±85° pitch. Missing or stale history preserves the table order.

### Conditional refinement

Selection and recovery reliability are separate thresholds. A face with confidence at least `0.6` can participate in subject selection, but a panorama candidate is accepted without refinement only when confidence reaches `0.7` and it is sufficiently far from distorted tile edges. The first edge or lower-confidence candidate in a pass receives one 70° square perspective tile centered on its mapped panorama direction. No later candidate in the same pass can add another refinement, bounding a 360° pass at seven inferences and a 180° pass at six. A refined result must satisfy the same reliability test; otherwise scanning resumes at the next coarse tile.

### Capture path

For a recovery tile, `VrRenderRuntime` performs one atomic capture transaction:

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

Each viewport inference freezes the camera pose and perspective parameters with the captured frame. Its detection is converted from screen-space face center into an absolute world yaw and pitch target using that immutable capture context, even if inference completes after the camera moves or the viewport is resized. This lets a locked target's remaining error decrease as the camera moves even when short movements intentionally pause inference. Position, world angle, and forward targets use exponential smoothing with a 480 ms time constant. Smoothing resets when the detection mode changes, the target gap exceeds 1.8 seconds, or a subject switch is detected.

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

Viewport detections use `sqrt(face.width * face.height)` as an approximate distance observation and target a normalized face size of `0.18`. Automatic forward/backward adjustment starts only when the observed size differs from the target by at least `0.02`, so sizes in the open interval `(0.16, 0.20)` remain in the depth dead zone. The camera translates along its current look direction instead of changing zoom or FOV. Positive `forward` values move toward the projection surface; negative values move away.

The target assumes a local projection-surface distance of 100 units for spherical modes and 65 units for the flat screen. Given the current forward position and observed face size, the remaining camera-to-surface distance is scaled by `observedSize / targetSize`. Movement toward the surface is capped at `35` units, while backward movement has no artificial coordinate limit; this allows a face larger than the target to keep shrinking until it enters the size dead zone or reaches the real projection-coverage boundary. This is an approximate depth response inferred from apparent face size; the source video does not provide metric depth.

Forward velocity uses the same exponential profile, capped at 16 units/s with an 18-unit distance scale, and the same 260 ms temporal velocity smoothing as yaw and pitch.

Manual zoom inputs use the same forward/backward camera axis instead of changing camera zoom or FOV. Pinch distance, wheel deltas, and keyboard steps are converted to a multiplicative scale, then applied to the remaining camera-to-surface distance:

```text
forwardTarget = surfaceDistance - (surfaceDistance - currentForward) / scale
```

Keyboard zoom uses a scale factor of `1.1` per step. Increasing scale approaches the projection surface asymptotically without crossing it, while decreasing scale can move away without an artificial backward limit. Normally, half-sphere boundary protection still constrains manual movement. When Debug is open, manual boundary blocking is disabled and a visible warning is emitted instead, allowing sufficiently large movement to expose areas outside the video. The perspective camera remains at zoom `1` with its configured FOV.

### Projection-edge protection and debug monitoring

Movement on 180-degree projections checks the complete viewport against the video hemisphere for each monitored yaw, pitch, or forward step. Rays are cast around all four viewport edges at quarter-edge intervals, intersected with the projection surface, and measured against the hemisphere boundary plane. Plane distance is used instead of yaw because the boundary appears curved near the poles.

Equirectangular modes use the 100-unit video sphere. Fisheye modes use the 99-unit back-half mask because its curved silhouette can occlude the outer video sphere first after camera translation. A view is covered only when every sampled point remains inside the half-sphere with a 2° seam margin.

Before movement starts, yaw, pitch, depth, panorama recovery, and projection coverage are resolved into one feasible target view. If the requested view crosses a 180-degree boundary, binary search replaces it with the last fully covered view. The render loop never teleports to a boundary and never applies a separate depth correction; it only follows this constrained target through the shared velocity and smoothing model. Once the feasible endpoint is reached while the original request remains outside coverage, tracking reports `blocked`, inference scheduling falls back to stable monitoring, and the copied log records the blocked axis. A new reachable target produces a new plan and resumes active movement. Manual movement retains its separate Debug behavior: Debug may apply the proposed manual step unchanged while reporting `Projection boundary · Manual <axis>`. Full 360-degree projections bypass coverage constraints.

### Manual override state

An effective manual rotation, forward/backward change, or view reset pauses detection, recovery scanning, and camera motion with no timeout. Starting an interaction without changing the view does not pause centering. A view reset also returns the camera to the projection center. Resuming clears the override and schedules an immediate viewport detection. Disabling centering or resetting the media also clears the override.

This section defines state behavior only; the UI used to expose these actions is outside this document's scope.

## Motion model

Motion prediction is updated only from viewport detections.

- `size = sqrt(face.width * face.height)` approximates subject proximity.
- `speed` is normalized face-center displacement per second.
- `recedingSpeed` is the decrease in `size` per second; positive values mean the subject appears to be moving away.
- Each viewport face center is also converted to world yaw and pitch by combining its perspective ray with the camera view. Differencing these world directions removes camera-follow rotation from subject-direction velocity and unwraps yaw at the 360° seam.
- Measurements use exponential smoothing with a 350 ms time constant.
- The raw viewport face size supplies the forward/backward target. Smoothed size, screen speed, and recession feed adaptive inference scheduling; smoothed world yaw/pitch velocity feeds recovery tile ordering.
- Motion history resets after a reliable-detection gap longer than 1.5 seconds, a subject switch, media changes, playback pause, disabled centering, or loss of the scene.

## Adaptive inference scheduling

The base activity limits are:

| Activity | Maximum frequency | Meaning |
| --- | ---: | --- |
| `stable` | 3 Hz | Face is composed and the camera is settled |
| `active` | 6 Hz | Face is outside the dead zone or a long automatic movement is being rescanned |
| `searching` | 5 Hz | No reliable target or repeated viewport misses |
| `recovery` | 6 Hz | Perspective recovery tiles are being scanned |

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

At the start of automatic movement, the controller estimates its duration by simulating the current yaw, pitch, and forward errors with the same nonlinear desired-velocity curves and 260 ms velocity smoothing used by rendering. The estimate ends when at least 95% of each initial axis error has been traversed. Movements estimated at 3.5 seconds or less lock their target and do not submit another inference until all three axes stop. Longer movements enable rescanning so a large camera move can correct for subject motion instead of remaining blind.

Long-movement rescans use one third of the latest remaining-duration estimate, clamped to 300–800 ms and never shorter than the measured inference P95 plus 50 ms. Each result can update the active target and produces a new duration estimate. Once movement stops, the long-movement state clears and the next due viewport inference runs immediately.

The first viewport miss preserves the missed inference's activity, adaptive maximum frequency, motion adjustment, and processing headroom for the detector retry. If the retry also misses, panorama recovery begins and subsequent tile scans use the `recovery` schedule.

## Render cadence isolation

The configured playback render rate limits ordinary video presentation but does not limit camera interaction. When `requestVideoFrameCallback` is available, ordinary playback scheduling uses each callback's media time: a due frame renders once, while an early frame is skipped until the next new video frame arrives. The scheduler does not request an animation-frame retry for a skipped video frame, which avoids presenting the same texture again and prevents a 60 fps video callback from slipping to the following display refresh. Browsers without video-frame callbacks retain animation-frame scheduling. While manual interaction or portrait centering moves the camera, rendering follows display animation-frame cadence. Returning to ordinary playback starts a fresh playback deadline so an old deadline cannot delay the first settled frame. Seeking clears the pending video frame and playback deadline both when the seek begins and when it settles, so a backward seek cannot compare its new media time against a deadline from the old position. Hidden documents stop scheduling WebGL frames and invalidate in-flight inference. When the document becomes visible or the window regains focus, the player discards its previous video-frame deadline and callback timing, resets the animation delta, requests fresh inference, and renders the current video texture immediately. Browser throttling while a page remains hidden cannot be bypassed, but it cannot leave stale cadence state after foreground recovery.

## Manual view interaction

By default, a manual three-dimensional view change temporarily pauses portrait centering. Manual changes include pointer or touch rotation, wheel or pinch depth movement, keyboard depth movement, and resetting the view. Entering this pause clears the selected face, centering target, motion history, recovery state, accumulated camera velocity, and pending inference schedule so automatic movement cannot fight the manual camera position.

The resume-after-view-movement preference is enabled by default. Every applied manual view change restarts a 1-second quiet period, so continuous interaction keeps extending the deadline. When the quiet period ends, the controller clears the temporary pause, sets the next detection time to zero, and requests a frame so viewport face scanning resumes immediately from the manually chosen view. Disabling the preference makes future pauses require an explicit resume; disabling it during a temporary pause converts the current pause to that persistent behavior.

## Maintenance contract

Changes to any of the following must update this document in the same change:

- face detector selection, confidence filtering, or target selection;
- face detector resource prefetch timing or lifecycle;
- viewport/recovery state transitions;
- scan tile count, order, yaw, pitch, FOV, or projection coverage;
- perspective capture or GPU readback behavior;
- perspective-to-panorama coordinate mapping;
- composition target, target smoothing, dead zones, or camera motion;
- forward/backward estimation or projection-edge protection;
- motion smoothing, proximity, movement, recession, or subject-switch calculations;
- activity states, frequency limits, thresholds, headroom, or P95 scheduling.

Primary implementation files:

- `src/features/vr/tracking/face-detection-state.ts` (viewport/recovery transitions and panorama recovery progress)
- `src/features/vr/tracking/face-sampling.ts`
- `src/features/vr/detection/protocol.ts` (detector and worker contracts)
- `src/features/vr/detection/face-tracker-client.ts` (worker selection, fallback, inference requests, and model resources)
- `src/features/vr/detection/face-detector-worker.ts` (off-main-thread MediaPipe inference entry)
- `src/features/vr/detection/mediapipe-client.ts` (normalized detector adapter)
- `src/features/vr/detection/face-detector-service.ts` (detector backend lifecycle)
- `src/features/vr/tracking/face-center-movement.ts` (camera constraints, centering motion, velocity, zoom targets, and per-frame movement transitions)
- `src/features/vr/tracking/face-target-tracking.ts` (detection targets, coordinate mapping, identity selection, motion prediction, and state)
- `src/features/vr/tracking/face-auto-center-controller.ts` (tracking aggregate ownership, manual override, media lifecycle, and immutable diagnostics snapshot)
- `src/features/vr/tracking/face-scan-controller.ts` (inference scheduling, capture selection, recovery state, detector submission, and result application)
- `src/features/vr/tracking/inference-schedule-policy.ts` (adaptive inference cadence)
- `src/features/vr/rendering/render-cadence-policy.ts` (video and interaction render cadence)
- `src/features/vr/config.ts` (projection modes, camera-view contract, and render-quality policy)
- `src/features/vr/rendering/projection.ts` (projection geometry and UV mapping)
- `src/features/vr/rendering/vr-player-renderer.ts` (Three.js camera, renderer, texture, and projection lifecycle)
- `src/features/vr/rendering/vr-render-runtime.ts` (visible rendering, viewport layout, inference readback, and atomic recovery-tile capture)
- `src/features/vr/scene.ts` (composition root and cross-module event ordering)

Primary tests:

- `src/features/vr/tracking/face-detection-state.test.ts`
- `src/features/vr/tracking/face-sampling.test.ts`
- `src/features/vr/tracking/face-auto-center.test.ts`
- `src/features/vr/tracking/face-scan-controller.test.ts`
- `src/features/vr/tracking/face-movement-step.test.ts`
- `src/features/vr/tracking/panorama-recovery.test.ts`
- `src/features/vr/tracking/inference-schedule-policy.test.ts`
- `src/features/vr/detection/face-detector-service.test.ts`
- `src/features/vr/detection/face-tracker-client.test.ts`
- `src/features/vr/rendering/render-cadence-policy.test.ts`

When changing the algorithm, update the relevant unit tests, run `bun run typecheck`, `bun run test`, and `bun run lint`, and verify that this document still describes the shipped constants and state transitions.
