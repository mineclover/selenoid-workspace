# ComfyUI Workflow Guide

Manual step-by-step guide for using `mixamo-sprite` OpenPose frames as ControlNet conditioning in ComfyUI.

---

## Prerequisites

| Requirement | Notes |
|-------------|-------|
| ComfyUI installed | [github.com/comfyanonymous/ComfyUI](https://github.com/comfyanonymous/ComfyUI) |
| SD 1.5 checkpoint | e.g. `v1-5-pruned.safetensors` in `models/checkpoints/` |
| OpenPose ControlNet model | `control_v11p_sd15_openpose.pth` in `models/controlnet/` |
| `mixamo-sprite` built | `npm install && npm run build` |

SDXL checkpoints require an SDXL-compatible ControlNet model (`controlnet-openpose-sdxl-1.0`). The workflow JSON structure is the same; only the model filenames differ.

---

## Step 1 — Render OpenPose frames

```bash
mixamo-sprite render \
  --fbx ./character.fbx \
  --openpose \
  --frames 8 \
  --frame-width 512 \
  --frame-height 1024 \
  --json \
  -o ./frames
```

Key flags:

- `--openpose` — renders COCO-18 / BODY_25 stick figures on a black background
- `--json` — saves `frame_N_keypoints.json` alongside each PNG (useful for debugging keypoint accuracy)
- `--normalize global` (default) — fixes the camera across all frames so root motion is visible; use `--normalize frame` if the character stays in place and you want it to fill the canvas every frame

After this step `./frames/` contains `frame_0.png` … `frame_7.png`.

---

## Step 2 — Generate per-frame workflow JSONs

```bash
mixamo-sprite generate ./frames \
  --model v1-5-pruned.safetensors \
  --controlnet control_v11p_sd15_openpose.pth \
  --prompt "anime girl with silver hair, flat 2D style, bright green background" \
  --seed 42 \
  --strength 0.9 \
  --workflow-out ./workflows
```

This writes one JSON file per frame: `frame_0_workflow.json` … `frame_7_workflow.json`.

The seed is incremented by 1 per frame (`42`, `43`, `44` …) so you get variation while keeping the generation deterministic. If you want all frames from the same seed point, pass `--seed 42` and note that the per-frame increment still applies.

---

## Step 3 — Import a workflow JSON into ComfyUI

1. Open ComfyUI in your browser (`http://127.0.0.1:8188`).
2. Either:
   - **Drag and drop** `frame_0_workflow.json` onto the canvas, or
   - Click the **Load** button in the top menu and select the file.
3. ComfyUI will recreate the 10-node graph exactly as generated.

---

## Step 4 — Swap in your actual model and ControlNet filenames

The workflow JSON stores the filenames you passed on the CLI. If your local filenames differ, update them in ComfyUI before running:

- **Node 1 — CheckpointLoaderSimple**: set `ckpt_name` to your checkpoint file (must match the filename in `models/checkpoints/`).
- **Node 5 — ControlNetLoader**: set `control_net_name` to your ControlNet model file (must match the filename in `models/controlnet/`).

You also need to upload the OpenPose PNG to ComfyUI's input folder:

- Click **Node 4 — LoadImage** → **Choose File** and select `frame_0.png`, or copy the PNG into `ComfyUI/input/` manually.

---

## Step 5 — Run for each frame

Click **Queue Prompt**. ComfyUI will generate and save the output under `output/`.

Repeat for each `frame_N_workflow.json`:

1. Load next workflow JSON (drag-and-drop replaces the current graph).
2. Upload the corresponding `frame_N.png` in Node 4.
3. Queue.

Alternatively use the auto-submit mode to skip manual steps:

```bash
mixamo-sprite generate ./frames \
  --model v1-5-pruned.safetensors \
  --controlnet control_v11p_sd15_openpose.pth \
  --prompt "anime girl with silver hair, flat 2D style, bright green background" \
  --seed 42 --strength 0.9 \
  --comfyui http://127.0.0.1:8188 \
  -o ./generated
```

This uploads each frame, queues it, waits for the result (up to 120 s), and downloads `frame_N_generated.png` to `./generated/`.

---

## Step 6 — Assemble the strip

Collect all generated PNGs into one directory (if you ran manually, copy them out of `ComfyUI/output/`), then:

```bash
mixamo-sprite strip ./generated -o ./sprite_strip.png
```

The strip is a horizontal concatenation of `frame_0_generated.png` … `frame_7_generated.png` in filename order.

---

## Node Graph Overview

The generated workflow contains exactly 10 nodes:

| Node | Class | Role |
|------|-------|------|
| 1 | `CheckpointLoaderSimple` | Loads the SD checkpoint; outputs model, CLIP, VAE |
| 2 | `CLIPTextEncode` | Encodes the positive prompt using CLIP from node 1 |
| 3 | `CLIPTextEncode` | Encodes the negative prompt |
| 4 | `LoadImage` | Loads the OpenPose PNG from ComfyUI's input folder |
| 5 | `ControlNetLoader` | Loads the ControlNet model |
| 6 | `ControlNetApply` | Applies ControlNet conditioning to the positive embedding; takes strength as input |
| 7 | `EmptyLatentImage` | Creates a blank latent at the target width/height |
| 8 | `KSampler` | Runs diffusion; takes model, conditionings, latent, seed, steps, CFG, sampler, scheduler |
| 9 | `VAEDecode` | Decodes the latent to pixel space |
| 10 | `SaveImage` | Saves to `ComfyUI/output/` with prefix `sprite` |

Data flow:

```
1 ──model──► 8
1 ──clip───► 2 ──conditioning──► 6 ──conditioned──► 8
1 ──clip───► 3 ──conditioning──► 8 (negative)
4 ──image──► 6
5 ──cn─────► 6
7 ──latent──► 8
8 ──samples─► 9 ──images──► 10
1 ──vae────► 9
```

---

## Recommended Models

**SD 1.5**

| Model | Source |
|-------|--------|
| `v1-5-pruned.safetensors` | [Runway SD 1.5 on HuggingFace](https://huggingface.co/runwayml/stable-diffusion-v1-5) |
| `control_v11p_sd15_openpose.pth` | [lllyasviel/ControlNet-v1-1](https://huggingface.co/lllyasviel/ControlNet-v1-1) |

**SDXL**

| Model | Source |
|-------|--------|
| Any SDXL checkpoint | e.g. `sd_xl_base_1.0.safetensors` |
| `controlnet-openpose-sdxl-1.0` | [thibaud/controlnet-openpose-sdxl-1.0](https://huggingface.co/thibaud/controlnet-openpose-sdxl-1.0) |

---

## Tips

**Seed consistency across frames**

Pass `--seed <n>` to `generate`. The CLI increments the seed by 1 per frame (`n`, `n+1`, `n+2` …), which keeps the character appearance consistent while allowing natural variation in cloth folds and minor details. If you want identical seeds for every frame, edit the workflow JSONs and set the same value in Node 8 before queuing.

**ControlNet strength tuning**

| Strength | Effect |
|----------|--------|
| `1.0` (default) | Tight pose adherence; recommended starting point |
| `0.8–0.9` | Slightly looser — allows the model more creative freedom while still following the pose |
| `< 0.7` | Pose may drift noticeably from the OpenPose reference |

For sprite work `0.8–1.0` is the practical range. Lower values are useful when the character has complex accessories or clothing that conflicts with the ControlNet skeleton.

**Frame normalization**

- `--normalize global` (default): the camera is fixed across all frames by sampling the full animation and computing a bounding box over key bones. Use this for animations with root motion (walk, run) so the character's position in the frame tracks naturally.
- `--normalize frame`: the character fills the canvas on every frame regardless of world position. Use this for stationary animations (idle, attack) where you want maximum frame real estate.

**Debugging OpenPose output**

Run `render` without `--openpose` first to verify the FBX loads correctly in 3D view (`--no-headless` to see the browser). Then add `--openpose --json` and inspect the generated `_keypoints.json` files to confirm bone detection before committing to a full generation run.
