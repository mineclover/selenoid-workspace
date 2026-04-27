/**
 * ComfyUI API client + OpenPose ControlNet workflow builder.
 *
 * API reference: https://github.com/comfyanonymous/ComfyUI/blob/master/server.py
 * Workflow format: node-graph JSON (each key = node id, value = {class_type, inputs})
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { join, basename, extname } from "node:path";

export interface GenerateOptions {
  framesDir: string;
  outputDir: string;
  prompt: string;
  negativePrompt?: string;
  model: string;
  controlnet: string;
  controlnetStrength?: number;
  width?: number;
  height?: number;
  steps?: number;
  cfg?: number;
  seed?: number;
  sampler?: string;
  scheduler?: string;
  comfyUrl?: string;         // if set, submit to ComfyUI; otherwise only save workflow JSON
  workflowOut?: string;      // directory to save per-frame workflow JSONs
}

export interface GenerateResult {
  workflowPaths: string[];
  generatedPaths: string[];
}

// ─── Workflow builder ──────────────────────────────────────────────────────────

function buildWorkflow(opts: {
  imageName: string;   // filename as seen in ComfyUI's input folder
  prompt: string;
  negativePrompt: string;
  model: string;
  controlnet: string;
  controlnetStrength: number;
  width: number;
  height: number;
  steps: number;
  cfg: number;
  seed: number;
  sampler: string;
  scheduler: string;
}): Record<string, unknown> {
  return {
    "1": {
      class_type: "CheckpointLoaderSimple",
      inputs: { ckpt_name: opts.model },
    },
    "2": {
      class_type: "CLIPTextEncode",
      inputs: { clip: ["1", 1], text: opts.prompt },
    },
    "3": {
      class_type: "CLIPTextEncode",
      inputs: { clip: ["1", 1], text: opts.negativePrompt },
    },
    "4": {
      class_type: "LoadImage",
      inputs: { image: opts.imageName, upload: "image" },
    },
    "5": {
      class_type: "ControlNetLoader",
      inputs: { control_net_name: opts.controlnet },
    },
    "6": {
      class_type: "ControlNetApply",
      inputs: {
        conditioning: ["2", 0],
        control_net:  ["5", 0],
        image:        ["4", 0],
        strength:     opts.controlnetStrength,
      },
    },
    "7": {
      class_type: "EmptyLatentImage",
      inputs: { width: opts.width, height: opts.height, batch_size: 1 },
    },
    "8": {
      class_type: "KSampler",
      inputs: {
        model:        ["1", 0],
        positive:     ["6", 0],
        negative:     ["3", 0],
        latent_image: ["7", 0],
        seed:         opts.seed,
        steps:        opts.steps,
        cfg:          opts.cfg,
        sampler_name: opts.sampler,
        scheduler:    opts.scheduler,
        denoise:      1.0,
      },
    },
    "9": {
      class_type: "VAEDecode",
      inputs: { samples: ["8", 0], vae: ["1", 2] },
    },
    "10": {
      class_type: "SaveImage",
      inputs: { images: ["9", 0], filename_prefix: "sprite" },
    },
  };
}

// ─── ComfyUI API helpers ───────────────────────────────────────────────────────

async function uploadImage(comfyUrl: string, pngPath: string): Promise<string> {
  const filename = basename(pngPath);
  const data = readFileSync(pngPath);
  const form = new globalThis.FormData();
  form.append("image", new globalThis.Blob([data], { type: "image/png" }), filename);
  form.append("type", "input");
  form.append("overwrite", "true");

  const res = await fetch(`${comfyUrl}/upload/image`, { method: "POST", body: form });
  if (!res.ok) throw new Error(`Upload failed: ${res.status} ${await res.text()}`);
  const json = await res.json() as { name: string };
  return json.name;
}

async function queuePrompt(comfyUrl: string, workflow: Record<string, unknown>): Promise<string> {
  const res = await fetch(`${comfyUrl}/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: workflow }),
  });
  if (!res.ok) throw new Error(`Queue failed: ${res.status} ${await res.text()}`);
  const json = await res.json() as { prompt_id: string };
  return json.prompt_id;
}

async function waitForResult(
  comfyUrl: string,
  promptId: string,
  timeoutMs = 120_000,
): Promise<{ filename: string; subfolder: string }[]> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 1000));
    const res = await fetch(`${comfyUrl}/history/${promptId}`);
    if (!res.ok) continue;
    const history = await res.json() as Record<string, unknown>;
    const entry = history[promptId] as { outputs?: Record<string, { images?: { filename: string; subfolder: string }[] }> } | undefined;
    if (!entry?.outputs) continue;

    const images: { filename: string; subfolder: string }[] = [];
    for (const node of Object.values(entry.outputs)) {
      if (node.images) images.push(...node.images);
    }
    if (images.length > 0) return images;
  }
  throw new Error(`Timed out waiting for prompt ${promptId}`);
}

async function downloadImage(comfyUrl: string, filename: string, subfolder: string, outPath: string): Promise<void> {
  const url = `${comfyUrl}/view?filename=${encodeURIComponent(filename)}&subfolder=${encodeURIComponent(subfolder)}&type=output`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(outPath, buf);
}

// ─── Main generate function ────────────────────────────────────────────────────

export async function generateSprites(opts: GenerateOptions): Promise<GenerateResult> {
  const {
    framesDir,
    outputDir,
    prompt,
    negativePrompt  = "lowres, blurry, bad anatomy, extra limbs, watermark",
    model,
    controlnet,
    controlnetStrength = 1.0,
    width           = 512,
    height          = 1024,
    steps           = 20,
    cfg             = 7,
    sampler         = "euler",
    scheduler       = "normal",
    comfyUrl,
    workflowOut,
  } = opts;

  mkdirSync(outputDir, { recursive: true });
  if (workflowOut) mkdirSync(workflowOut, { recursive: true });

  const pngFiles = readdirSync(framesDir)
    .filter(f => f.match(/^frame_\d+\.png$/))
    .sort()
    .map(f => join(framesDir, f));

  if (pngFiles.length === 0) throw new Error(`No frame_N.png files found in ${framesDir}`);

  const workflowPaths: string[] = [];
  const generatedPaths: string[] = [];

  for (let i = 0; i < pngFiles.length; i++) {
    const pngPath = pngFiles[i];
    const stem    = basename(pngPath, extname(pngPath));
    const seed    = opts.seed !== undefined ? opts.seed + i : Math.floor(Math.random() * 2 ** 32);

    let imageName = basename(pngPath);

    if (comfyUrl) {
      process.stdout.write(`[generate] frame ${i + 1}/${pngFiles.length} — uploading...`);
      imageName = await uploadImage(comfyUrl, pngPath);
    }

    const workflow = buildWorkflow({
      imageName, prompt, negativePrompt, model, controlnet,
      controlnetStrength, width, height, steps, cfg, seed, sampler, scheduler,
    });

    if (workflowOut) {
      const wfPath = join(workflowOut, `${stem}_workflow.json`);
      writeFileSync(wfPath, JSON.stringify(workflow, null, 2));
      workflowPaths.push(wfPath);
    }

    if (!comfyUrl) continue;

    process.stdout.write(` queuing...`);
    const promptId = await queuePrompt(comfyUrl, workflow);

    process.stdout.write(` waiting...`);
    const images = await waitForResult(comfyUrl, promptId);

    const outPath = join(outputDir, `${stem}_generated.png`);
    await downloadImage(comfyUrl, images[0].filename, images[0].subfolder, outPath);
    generatedPaths.push(outPath);
    console.log(` → ${outPath}`);
  }

  return { workflowPaths, generatedPaths };
}
