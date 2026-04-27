# mixamo-sprite

Mixamo FBX → OpenPose PNG/JSON → ComfyUI ControlNet → AI sprite pipeline.

Takes a Mixamo character and animation FBX, renders COCO-18 OpenPose stick figures frame-by-frame via Three.js + Puppeteer, feeds them into ComfyUI as ControlNet conditioning, and assembles the generated frames into a horizontal sprite strip.

```
FBX file(s)
    │
    ▼ render --openpose
OpenPose PNGs + keypoint JSONs
    │
    ▼ generate --workflow-out / --comfyui
Per-frame workflow JSONs  →  (optional) auto-submit to ComfyUI
    │
    ▼ strip
Sprite strip PNG
```

---

## Installation

```bash
npm install
npm run build
```

The `mixamo-sprite` binary is registered via the `bin` field in `package.json`; after `npm install -g` (or `npm link`) it is available on your `PATH`.

**Runtime dependencies**

| Dependency | Purpose |
|------------|---------|
| `puppeteer` | Headless Chromium for Three.js rendering |
| `three` | Loaded in-browser via CDN (no local install needed) |
| `sharp` | Frame extraction / image manipulation |
| `ffmpeg` | MP4 assembly (`--video`); must be on `PATH` |
| `magick` | Background removal (`remove-bg`, `extract`); ImageMagick 7+ |

---

## Commands

### `render` — FBX → OpenPose frames

Spins up a local HTTP server, loads the FBX in a headless Chromium viewport via Three.js, and captures one PNG per animation frame. With `--openpose` it draws a COCO-18 / BODY_25 stick figure instead of the 3D view.

```
mixamo-sprite render [options]
```

**FBX input (one of)**

| Flag | Description |
|------|-------------|
| `--fbx <path>` | Single FBX containing both character mesh/skeleton and animation |
| `--char <path>` | Character FBX (mesh + skeleton); pair with `--anim` |
| `--anim <path>` | Separate animation FBX retargeted onto `--char` |

**Frame sampling**

| Flag | Default | Description |
|------|---------|-------------|
| `--frames <n>` | `8` | Number of evenly-spaced snapshots across the full animation (ignored when `--fps` is set) |
| `--fps <n>` | — | Capture at this frame rate; total frames = `ceil(duration × fps)` |

**Viewport**

| Flag | Default | Description |
|------|---------|-------------|
| `--frame-width <n>` | `512` | Output frame width in pixels |
| `--frame-height <n>` | `1024` | Output frame height in pixels |
| `--view <v>` | `side` (3D) / `front` (openpose) | Camera angle: `side`, `front`, `back` |
| `--frustum <n>` | auto-fit | Orthographic frustum height in model units |
| `--bg <color>` | `#00FF00` | Background color for chroma keying (3D mode only; openpose always uses black) |
| `--no-headless` | — | Show the browser window (useful for debugging) |

**OpenPose options**

| Flag | Default | Description |
|------|---------|-------------|
| `--openpose` | — | Render COCO-18 OpenPose stick figure instead of 3D view |
| `--normalize <mode>` | `global` | `global`: fixed camera across all frames, shows root motion; `frame`: character always fills the canvas |
| `--json` | — | Save OpenPose keypoint JSON alongside each PNG (openpose mode only) |

**Output**

| Flag | Default | Description |
|------|---------|-------------|
| `-o, --output <dir>` | `<fbx-dir>/frames` | Output directory for `frame_N.png` files |
| `--strip <path>` | — | Also assemble frames into a horizontal sprite strip PNG |
| `--video <path>` | — | Assemble captured frames into an MP4 (requires `ffmpeg`) |

**Examples**

```bash
# 8-frame openpose strip from a single FBX
mixamo-sprite render --fbx ./walk.fbx --openpose -o ./frames --strip ./openpose.png

# Separate character + animation, 24 fps, save keypoint JSONs
mixamo-sprite render --char ./char.fbx --anim ./walk.fbx \
  --openpose --fps 24 --json -o ./frames

# 3D preview, side view, green-screen background, 12 frames
mixamo-sprite render --fbx ./walk.fbx --frames 12 --view side --bg "#00FF00" -o ./frames

# Debug: show browser window
mixamo-sprite render --fbx ./walk.fbx --openpose --no-headless
```

---

### `generate` — OpenPose frames → ComfyUI ControlNet images

Builds a 10-node ComfyUI workflow JSON per frame (CheckpointLoader → CLIPTextEncode × 2 → LoadImage → ControlNetLoader → ControlNetApply → EmptyLatentImage → KSampler → VAEDecode → SaveImage). Optionally submits each workflow to a running ComfyUI instance and downloads the result.

```
mixamo-sprite generate <frames-dir> --model <ckpt> --controlnet <cn> --prompt <text> [options]
```

**Required**

| Flag | Description |
|------|-------------|
| `--model <name>` | ComfyUI checkpoint filename, e.g. `v1-5-pruned.safetensors` |
| `--controlnet <name>` | ControlNet model filename, e.g. `control_v11p_sd15_openpose.pth` |
| `--prompt <text>` | Positive prompt for AI generation |

**Generation parameters**

| Flag | Default | Description |
|------|---------|-------------|
| `--negative <text>` | `"lowres, blurry, bad anatomy, extra limbs, watermark"` | Negative prompt |
| `--strength <n>` | `1.0` | ControlNet conditioning strength |
| `--width <n>` | `512` | Output width in pixels |
| `--height <n>` | `1024` | Output height in pixels |
| `--steps <n>` | `20` | Sampling steps |
| `--cfg <n>` | `7` | CFG scale |
| `--seed <n>` | random | Base seed; incremented by 1 per frame for consistency |
| `--sampler <name>` | `euler` | Sampler name |
| `--scheduler <name>` | `normal` | Scheduler name |

**Output**

| Flag | Default | Description |
|------|---------|-------------|
| `--comfyui <url>` | `http://127.0.0.1:8188` | ComfyUI base URL; frames are uploaded, queued, and downloaded automatically when reachable |
| `--workflow-out <dir>` | — | Save per-frame workflow JSONs to this directory (always works, even without ComfyUI) |
| `-o, --output <dir>` | `./generated` | Output directory for downloaded generated images |

If ComfyUI is unreachable the command falls back to workflow-JSON-only mode (requires `--workflow-out`).

**Examples**

```bash
# Save workflow JSONs for manual import (no ComfyUI required)
mixamo-sprite generate ./frames \
  --model v1-5-pruned.safetensors \
  --controlnet control_v11p_sd15_openpose.pth \
  --prompt "anime girl, flat 2D style, green screen background" \
  --workflow-out ./workflows

# Auto-submit to local ComfyUI, fixed seed for frame consistency
mixamo-sprite generate ./frames \
  --model v1-5-pruned.safetensors \
  --controlnet control_v11p_sd15_openpose.pth \
  --prompt "knight in armor, side view, pixel art" \
  --seed 42 --strength 0.9 --steps 25 \
  --comfyui http://127.0.0.1:8188 -o ./generated
```

---

### `strip` — assemble frames into a sprite strip

Horizontally concatenates all `frame_XX.png` files in a directory into a single PNG strip using ImageMagick `+append`.

```
mixamo-sprite strip <dir> [options]
```

| Flag | Default | Description |
|------|---------|-------------|
| `-o, --output <path>` | `<dir>/strip.png` | Output strip PNG path |

**Example**

```bash
mixamo-sprite strip ./generated -o ./sprite_strip.png
```

---

### `extract` — split AI grid sheet into individual frames

Splits an AI-generated grid sprite sheet (e.g. from an image model that outputs a 4×2 grid) into individual frames, removes the chroma-key background, and optionally assembles a strip.

```
mixamo-sprite extract <sheet> [options]
```

| Flag | Default | Description |
|------|---------|-------------|
| `--cols <n>` | `4` | Number of columns in the grid |
| `--rows <n>` | `2` | Number of rows in the grid |
| `--frame-width <n>` | auto (image width ÷ cols) | Frame width in pixels |
| `--frame-height <n>` | auto (image height ÷ rows) | Frame height in pixels |
| `--bg-color <color>` | `#00FF00` | Background color to remove |
| `--fuzz <n>` | `12` | Background removal fuzz tolerance (%) |
| `-o, --output <dir>` | `<sheet-dir>/frames` | Output directory for extracted frames |
| `--strip <path>` | `<output-dir>/../strip.png` | Also assemble into a strip PNG |

**Example**

```bash
mixamo-sprite extract ./ai_sheet.png --cols 4 --rows 2 --strip ./strip.png
```

---

### `remove-bg` — chroma key removal

Removes a solid background color from a single image using ImageMagick's `-transparent` with fuzz tolerance.

```
mixamo-sprite remove-bg <input> [options]
```

| Flag | Default | Description |
|------|---------|-------------|
| `-o, --output <path>` | `<input>_rgba.png` | Output path |
| `--color <hex>` | `#00FF00` | Background color to remove |
| `--fuzz <n>` | `12` | Fuzz tolerance (%) |

**Example**

```bash
mixamo-sprite remove-bg ./sprite.png --color "#00FF00" --fuzz 15 -o ./sprite_rgba.png
```

---

### `prompt` — generate AI prompt text

Prints a positive and negative prompt for generating a sprite sheet with an image model, sized to the target strip dimensions.

```
mixamo-sprite prompt [options]
```

| Flag | Default | Description |
|------|---------|-------------|
| `--character <desc>` | `"anime girl with silver hair"` | Character description |
| `--animation <name>` | `"walking cycle"` | Animation name |
| `--frames <n>` | `8` | Frame count |
| `--frame-width <n>` | `512` | Frame width in pixels |
| `--frame-height <n>` | `1024` | Frame height in pixels |
| `--style <style>` | `"flat 2D anime"` | Art style |
| `--background <desc>` | `"solid bright green (#00FF00)"` | Background description |

**Example**

```bash
mixamo-sprite prompt \
  --character "knight in armor" \
  --animation "run cycle" \
  --frames 8 --frame-width 512 --frame-height 1024 \
  --style "pixel art"
```

---

## Full Pipeline Example

End-to-end: Mixamo FBX → OpenPose frames → ComfyUI ControlNet → sprite strip.

```bash
# 1. Render 8 OpenPose frames from a Mixamo FBX (separate char + anim)
mixamo-sprite render \
  --char ./character.fbx \
  --anim ./walk.fbx \
  --openpose \
  --frames 8 \
  --frame-width 512 \
  --frame-height 1024 \
  --json \
  -o ./frames

# 2. (Optional) check the prompt text
mixamo-sprite prompt \
  --character "anime girl, silver hair" \
  --animation "walk cycle" \
  --frames 8 --frame-width 512 --frame-height 1024

# 3a. Generate workflow JSONs for manual ComfyUI import
mixamo-sprite generate ./frames \
  --model v1-5-pruned.safetensors \
  --controlnet control_v11p_sd15_openpose.pth \
  --prompt "anime girl with silver hair, flat 2D style, green screen background" \
  --seed 42 \
  --workflow-out ./workflows

# 3b. OR auto-submit to a running ComfyUI instance
mixamo-sprite generate ./frames \
  --model v1-5-pruned.safetensors \
  --controlnet control_v11p_sd15_openpose.pth \
  --prompt "anime girl with silver hair, flat 2D style, green screen background" \
  --seed 42 \
  --comfyui http://127.0.0.1:8188 \
  -o ./generated

# 4. Assemble generated frames into a strip
mixamo-sprite strip ./generated -o ./sprite_strip.png
```

**Output layout after step 4:**

```
frames/
  frame_0.png  … frame_7.png       ← OpenPose stick figures
  frame_0_keypoints.json … (if --json)
workflows/
  frame_0_workflow.json … (if --workflow-out)
generated/
  frame_0_generated.png … frame_7_generated.png
sprite_strip.png                   ← final horizontal strip
```

---

## See Also

- [`docs/comfyui-workflow-guide.md`](docs/comfyui-workflow-guide.md) — manual ComfyUI workflow import walkthrough
- [`docs/openpose-body25-mapping.md`](docs/openpose-body25-mapping.md) — BODY_25 keypoint index and Mixamo bone mapping reference
