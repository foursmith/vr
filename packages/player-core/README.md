# @foursmith/player-core

UI-agnostic VR video rendering core shared by the Foursmith VR app and its
minimal memory baseline player.

The package owns:

- the Three.js renderer, scene, camera, and `VideoTexture`;
- projection geometry and UV mapping;
- render quality and device-pixel-ratio scaling;
- resize, projection rebuild, media reset, and GPU cleanup.

Application concerns such as controls, playlists, subtitles, persistence,
gesture policy, and face tracking stay outside the package.

```ts
import { createVrPlayerCore } from "@foursmith/player-core"

const core = createVrPlayerCore({
  video,
  canvas,
  projection: "sbs_180_eqr",
  quality: "sharp",
  width: canvas.clientWidth,
  height: canvas.clientHeight,
  devicePixelRatio: window.devicePixelRatio,
})

core.render()
core.setSize(width, height)
core.setProjection("mono_360_eqr")
core.destroy()
```
