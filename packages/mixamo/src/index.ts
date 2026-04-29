#!/usr/bin/env node

import { Command } from "commander";
import { resolve, join } from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import { captureMixamo } from "./capture.js";
import { sheetToStrip, loadFramePaths, assembleStrip, removeBackground, extractFrames } from "./frames.js";
import { buildPrompt, printPrompt } from "./prompt.js";
import { captureFbx } from "./render/capture.js";
import { generateSprites } from "./comfy.js";

const program = new Command();

program
  .name("mixamo-sprite")
  .description("Mixamo pose capture → AI sprite generation pipeline")
  .version("0.1.0");

// ─── capture ──────────────────────────────────────────────────────────────────
program
  .command("capture")
  .description("Open Mixamo in browser and capture animation frames")
  .option("--url <url>", "Mixamo URL", "https://www.mixamo.com/")
  .option("--frames <n>", "Number of frames to capture", "8")
  .option("--frame-width <n>", "Viewport/frame width px", "512")
  .option("--frame-height <n>", "Viewport/frame height px", "1024")
  .option("--background <color>", "Background color for chroma key", "#00FF00")
  .option("--headless", "Run headless (requires prior login session)")
  .option("-o, --output <dir>", "Output directory for frames", "./frames")
  .action(async (opts: {
    url: string; frames: string; frameWidth: string; frameHeight: string;
    background: string; headless?: boolean; output: string;
  }) => {
    const result = await captureMixamo({
      url: opts.url,
      frames: parseInt(opts.frames, 10),
      frameWidth: parseInt(opts.frameWidth, 10),
      frameHeight: parseInt(opts.frameHeight, 10),
      background: opts.background,
      headless: opts.headless ?? false,
      outputDir: resolve(opts.output),
    });

    console.log(`\nCaptured ${result.frames.length} frames → ${resolve(opts.output)}`);
    console.log("Next: run `mixamo-sprite strip` to assemble into a sprite strip");
  });

// ─── extract ──────────────────────────────────────────────────────────────────
program
  .command("extract")
  .description("Extract individual frames from an AI-generated grid sprite sheet")
  .argument("<sheet>", "Path to sprite sheet image (PNG/JPEG/WebP)")
  .option("--cols <n>", "Columns", "4")
  .option("--rows <n>", "Rows", "2")
  .option("--frame-width <n>",  "Frame width px (auto from image/cols if omitted)")
  .option("--frame-height <n>", "Frame height px (auto from image/rows if omitted)")
  .option("--bg-color <color>", "Background color to remove", "#00FF00")
  .option("--fuzz <n>", "Background removal fuzz %", "12")
  .option("-o, --output <dir>", "Output directory for frames")
  .option("--strip <path>", "Also assemble frames into a strip PNG")
  .action(async (sheetPath: string, opts: {
    cols: string; rows: string;
    frameWidth?: string; frameHeight?: string;
    bgColor: string; fuzz: string;
    output?: string; strip?: string;
  }) => {
    const { default: sharp } = await import("sharp");
    const meta = await sharp(resolve(sheetPath)).metadata();
    const imgW = meta.width ?? 0;
    const imgH = meta.height ?? 0;

    const cols = parseInt(opts.cols, 10);
    const rows = parseInt(opts.rows, 10);
    const fw = opts.frameWidth  ? parseInt(opts.frameWidth, 10)  : Math.floor(imgW / cols);
    const fh = opts.frameHeight ? parseInt(opts.frameHeight, 10) : Math.floor(imgH / rows);

    const outDir = resolve(opts.output ?? join(resolve(sheetPath), "..", "frames"));
    mkdirSync(outDir, { recursive: true });

    const stripPath = opts.strip ? resolve(opts.strip) : join(outDir, "..", "strip.png");

    console.log(`Sheet: ${imgW}×${imgH} · ${cols}×${rows} grid · frame ${fw}×${fh}`);

    const result = await sheetToStrip({
      sheetPath: resolve(sheetPath),
      outputDir: outDir,
      stripPath,
      cols, rows, frameWidth: fw, frameHeight: fh,
      bgColor: opts.bgColor,
      fuzz: parseInt(opts.fuzz, 10),
    });

    console.log(`Frames: ${result.frames.length} → ${outDir}`);
    console.log(`Strip:  ${stripPath}`);
    console.log(`\nUse with render-sprites:`);
    console.log(`  frameWidth: ${fw}, frameHeight: ${fh}, rows: 1`);
  });

// ─── strip ────────────────────────────────────────────────────────────────────
program
  .command("strip")
  .description("Assemble frame PNGs from a directory into a horizontal sprite strip")
  .argument("<dir>", "Directory containing frame_XX.png files")
  .option("-o, --output <path>", "Output strip PNG path (default: <dir>/strip.png)")
  .action(async (dir: string, opts: { output?: string }) => {
    const dirPath = resolve(dir);
    const framePaths = loadFramePaths(dirPath);
    if (framePaths.length === 0) {
      console.error(`No frame_XX.png files found in ${dirPath}`);
      process.exit(1);
    }

    const outPath = resolve(opts.output ?? join(dirPath, "strip.png"));
    await assembleStrip(framePaths, outPath);
    console.log(`Strip: ${outPath} (${framePaths.length} frames)`);
  });

// ─── remove-bg ────────────────────────────────────────────────────────────────
program
  .command("remove-bg")
  .description("Remove background color from a sprite sheet or individual frame")
  .argument("<input>", "Input image path")
  .option("-o, --output <path>", "Output path (default: <input>_rgba.png)")
  .option("--color <hex>", "Background color to remove", "#00FF00")
  .option("--fuzz <n>", "Fuzz tolerance %", "12")
  .action(async (inputPath: string, opts: { output?: string; color: string; fuzz: string }) => {
    const inPath  = resolve(inputPath);
    const outPath = resolve(opts.output ?? inPath.replace(/(\.\w+)$/, "_rgba.png"));
    await removeBackground(inPath, outPath, opts.color, parseInt(opts.fuzz, 10));
    console.log(`Saved: ${outPath}`);
  });

// ─── prompt ───────────────────────────────────────────────────────────────────
program
  .command("prompt")
  .description("Generate an AI image generation prompt for a sprite sheet")
  .option("--character <desc>", "Character description", "anime girl with silver hair")
  .option("--animation <name>", "Animation name", "walking cycle")
  .option("--frames <n>", "Frame count", "8")
  .option("--frame-width <n>",  "Frame width px",  "512")
  .option("--frame-height <n>", "Frame height px", "1024")
  .option("--style <style>", "Art style", "flat 2D anime")
  .option("--background <desc>", "Background description", "solid bright green (#00FF00)")
  .action((opts: {
    character: string; animation: string; frames: string;
    frameWidth: string; frameHeight: string; style: string; background: string;
  }) => {
    const result = buildPrompt({
      character: opts.character,
      animation: opts.animation,
      frameCount: parseInt(opts.frames, 10),
      frameWidth: parseInt(opts.frameWidth, 10),
      frameHeight: parseInt(opts.frameHeight, 10),
      style: opts.style,
      background: opts.background,
    });
    printPrompt(result);
  });

// ─── render ───────────────────────────────────────────────────────────────────
program
  .command("render")
  .description("Render Mixamo FBX to a sprite strip using Three.js + Puppeteer")
  .option("--char <path>", "Character FBX path (mesh + skeleton)")
  .option("--anim <path>", "Animation FBX path (retargeted onto --char)")
  .option("--fbx <path>",  "Single FBX with both character and animation")
  .option("--frames <n>",       "Number of frames to capture (ignored when --fps is set)", "8")
  .option("--fps <n>",          "Capture at this frame rate; total frames = ceil(duration × fps)")
  .option("--frame-width <n>",  "Output frame width px",  "512")
  .option("--frame-height <n>", "Output frame height px", "1024")
  .option("--view <v>", "Camera view: side | front | back (openpose default: front)")
  .option("--bg <color>", "Background color for chroma key", "#00FF00")
  .option("--frustum <n>", "Orthographic frustum height in model units (auto-fit if omitted)")
  .option("--openpose", "Render COCO-18 OpenPose stick figure instead of 3D view")
  .option("--engine <e>", "Render engine: three (Three.js+Puppeteer, default) | blender (headless Blender)", "three")
  .option("--blender <path>", "Path to Blender binary (auto-detected if omitted)")
  .option("--json", "Save OpenPose JSON keypoints alongside each PNG (openpose mode only)")
  .option("--no-headless", "Show browser window (useful for debugging)")
  .option("-o, --output <dir>", "Output directory for frames")
  .option("--strip <path>", "Also assemble frames into a strip PNG")
  .option("--video <path>", "Assemble captured frames into an MP4 (requires ffmpeg)")
  .action(async (opts: {
    char?: string; anim?: string; fbx?: string;
    frames: string; fps?: string; frameWidth: string; frameHeight: string;
    view: string; bg: string; frustum?: string;
    openpose?: boolean; engine: string; blender?: string; json?: boolean;
    headless: boolean; output?: string; strip?: string; video?: string;
  }) => {
    const charPath = resolve(opts.char ?? opts.fbx ?? "");
    const animPath = opts.anim ? resolve(opts.anim) : undefined;

    if (!opts.char && !opts.fbx) {
      console.error("Provide --char <character.fbx> or --fbx <combined.fbx>");
      process.exit(1);
    }
    if (!existsSync(charPath)) {
      console.error(`File not found: ${charPath}`);
      process.exit(1);
    }
    if (animPath && !existsSync(animPath)) {
      console.error(`Animation FBX not found: ${animPath}`);
      process.exit(1);
    }

    const fps        = opts.fps ? parseFloat(opts.fps) : undefined;
    const frameCount = parseInt(opts.frames, 10);
    const frameWidth  = parseInt(opts.frameWidth, 10);
    const frameHeight = parseInt(opts.frameHeight, 10);
    const outDir = resolve(opts.output ?? join(charPath, "..", "frames"));

    console.log(`Char:   ${charPath}`);
    if (animPath) console.log(`Anim:   ${animPath}`);
    if (fps) {
      console.log(`FPS:    ${fps} · ${frameWidth}×${frameHeight} · view=${opts.view}`);
    } else {
      console.log(`Frames: ${frameCount} · ${frameWidth}×${frameHeight} · view=${opts.view}`);
    }

    const mode = opts.openpose ? "openpose" : "3d";
    const view = (opts.view ?? (opts.openpose ? "front" : "side")) as "side" | "front" | "back";
    console.log(`Mode:   ${mode}`);

    const videoPath = opts.video ? resolve(opts.video) : undefined;

    let result;
    try {
      result = await captureFbx({
        charPath,
        animPath,
        outputDir:     outDir,
        frames:        fps ? undefined : frameCount,
        fps,
        frameWidth,
        frameHeight,
        view,
        bgColor:       opts.openpose ? "#000000" : opts.bg,
        frustumHeight: opts.frustum ? parseFloat(opts.frustum) : undefined,
        headless:      opts.headless,
        mode,
        engine:        opts.engine as "three" | "blender",
        blenderPath:   opts.blender,
        saveJson:      opts.json ?? false,
        videoPath,
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`\n[render error] ${msg}`);
      if (msg.includes("6100") || msg.includes("version not supported")) {
        console.error("  → FBX must be binary v7.x. Use a Mixamo 'With Skin' FBX as --char.");
        console.error(`  → Workaround: --char "Jumping Down.fbx" --anim "${animPath ?? charPath}"`);
      }
      process.exit(1);
    }

    console.log(`\nFrames: ${result.framePaths.length} → ${outDir}`);
    if (result.jsonPaths.length > 0) {
      console.log(`JSON:   ${result.jsonPaths.length} keypoint files → ${outDir}`);
    }
    if (result.videoPath) {
      console.log(`Video:  ${result.videoPath}`);
    }

    if (opts.strip) {
      const stripPath = resolve(opts.strip);
      const { assembleStrip } = await import("./frames.js");
      await assembleStrip(result.framePaths, stripPath);
      console.log(`Strip:  ${stripPath}`);
      console.log(`\nlayers.json entry:`);
      console.log(JSON.stringify({
        name: "char.png",
        file: stripPath,
        frameWidth,
        frameHeight,
        rows: 1,
        loop: true,
      }, null, 2));
    }
  });

// ─── batch ────────────────────────────────────────────────────────────────────
program
  .command("batch")
  .description("Render all FBX files in a directory as separate frame sequences")
  .argument("<dir>", "Directory containing *.fbx files")
  .option("--fps <n>",          "Capture frame rate; total frames = ceil(duration × fps)")
  .option("--frames <n>",       "Number of frames per FBX (ignored when --fps is set)", "8")
  .option("--frame-width <n>",  "Output frame width px",  "512")
  .option("--frame-height <n>", "Output frame height px", "1024")
  .option("--view <v>",         "Camera view: side | front | back")
  .option("--openpose",         "Render COCO-18 OpenPose stick figure instead of 3D view")
  .option("--engine <e>",       "Render engine: three | blender", "three")
  .option("--blender <path>",   "Path to Blender binary (auto-detected if omitted)")
  .option("--json",             "Save OpenPose JSON keypoints (openpose mode only)")
  .option("--video",            "Assemble each FBX's frames into an MP4")
  .option("-o, --output <dir>", "Root output directory (default: <dir>/rendered)")
  .action(async (dir: string, opts: {
    fps?: string; frames: string; frameWidth: string; frameHeight: string;
    view?: string; openpose?: boolean; engine: string; blender?: string;
    json?: boolean; video?: boolean; output?: string;
  }) => {
    const { readdirSync } = await import("node:fs");
    const { basename } = await import("node:path");

    const srcDir    = resolve(dir);
    const outRoot   = resolve(opts.output ?? join(srcDir, "rendered"));
    const fbxFiles  = readdirSync(srcDir).filter(f => f.toLowerCase().endsWith(".fbx"));

    if (fbxFiles.length === 0) {
      console.error(`No .fbx files found in ${srcDir}`);
      process.exit(1);
    }

    const fps        = opts.fps ? parseFloat(opts.fps) : undefined;
    const frameCount = parseInt(opts.frames, 10);
    const frameWidth  = parseInt(opts.frameWidth, 10);
    const frameHeight = parseInt(opts.frameHeight, 10);
    const mode        = opts.openpose ? "openpose" : "3d";
    const view        = (opts.view ?? (opts.openpose ? "front" : "side")) as "side" | "front" | "back";

    console.log(`Batch: ${fbxFiles.length} FBX files in ${srcDir}`);

    let passed = 0;
    let failed = 0;

    for (const fbxFile of fbxFiles) {
      const charPath = join(srcDir, fbxFile);
      const stem     = basename(fbxFile, ".fbx");
      const outDir   = join(outRoot, stem, "frames");
      const videoPath = opts.video ? join(outRoot, stem, `${stem}.mp4`) : undefined;

      console.log(`\n[${stem}]`);
      try {
        const result = await captureFbx({
          charPath,
          outputDir:   outDir,
          frames:      fps ? undefined : frameCount,
          fps,
          frameWidth,
          frameHeight,
          view,
          bgColor:     opts.openpose ? "#000000" : "#00FF00",
          mode,
          engine:      opts.engine as "three" | "blender",
          blenderPath: opts.blender,
          saveJson:    opts.json ?? false,
          videoPath,
        });
        console.log(`  → ${result.framePaths.length} frames → ${outDir}`);
        if (result.videoPath) console.log(`  → video: ${result.videoPath}`);
        passed++;
      } catch (e: unknown) {
        console.error(`  [error] ${e instanceof Error ? e.message : String(e)}`);
        failed++;
      }
    }

    console.log(`\nBatch done: ${passed} passed, ${failed} failed`);
  });

// ─── process ──────────────────────────────────────────────────────────────────
program
  .command("process")
  .description("Remove background, assemble strip, and write layers.json from a frames directory")
  .argument("<frames-dir>", "Directory containing frame_N.png files")
  .option("--bg-color <color>", "Background color to remove", "#000000")
  .option("--fuzz <n>",         "Background removal fuzz %", "12")
  .option("--frame-width <n>",  "Frame width px (read from first frame if omitted)")
  .option("--frame-height <n>", "Frame height px (read from first frame if omitted)")
  .option("--strip <path>",     "Output strip PNG (default: <frames-dir>/../strip.png)")
  .option("--layers <path>",    "Output layers.json path (default: <frames-dir>/../layers.json)")
  .option("--name <name>",      "Layer name in layers.json", "char")
  .option("--no-loop",          "Set loop:false in layers.json")
  .action(async (framesDir: string, opts: {
    bgColor: string; fuzz: string;
    frameWidth?: string; frameHeight?: string;
    strip?: string; layers?: string; name: string; loop: boolean;
  }) => {
    const { default: sharp } = await import("sharp");
    const { writeFileSync } = await import("node:fs");

    const srcDir    = resolve(framesDir);
    const framePaths = loadFramePaths(srcDir);

    if (framePaths.length === 0) {
      console.error(`No frame_N.png files found in ${srcDir}`);
      process.exit(1);
    }

    // Infer dimensions from first frame if not provided
    let fw = opts.frameWidth  ? parseInt(opts.frameWidth, 10)  : 0;
    let fh = opts.frameHeight ? parseInt(opts.frameHeight, 10) : 0;
    if (!fw || !fh) {
      const meta = await sharp(framePaths[0]).metadata();
      fw = fw || meta.width  || 512;
      fh = fh || meta.height || 1024;
    }

    const stripPath  = resolve(opts.strip  ?? join(srcDir, "..", "strip.png"));
    const layersPath = resolve(opts.layers ?? join(srcDir, "..", "layers.json"));
    const fuzz       = parseInt(opts.fuzz, 10);

    // Remove background from each frame into temp RGBA PNGs, then strip
    const tmpDir = join(srcDir, ".rgba");
    mkdirSync(tmpDir, { recursive: true });

    console.log(`Removing background (${opts.bgColor}, fuzz=${fuzz}%) from ${framePaths.length} frames...`);
    const rgbaPaths: string[] = [];
    for (const fp of framePaths) {
      const out = join(tmpDir, resolve(fp).replace(/\//g, "_").replace(/^_/, "") + ".rgba.png");
      await removeBackground(fp, out, opts.bgColor, fuzz);
      rgbaPaths.push(out);
    }

    console.log(`Assembling strip → ${stripPath}`);
    await assembleStrip(rgbaPaths, stripPath);

    const layersEntry = {
      name:        opts.name,
      file:        stripPath,
      frameWidth:  fw,
      frameHeight: fh,
      rows:        1,
      loop:        opts.loop,
    };
    writeFileSync(layersPath, JSON.stringify([layersEntry], null, 2));
    console.log(`layers.json → ${layersPath}`);

    // Clean up temp RGBA files
    const { rmSync } = await import("node:fs");
    rmSync(tmpDir, { recursive: true, force: true });

    console.log(`\nDone: ${framePaths.length} frames → strip + layers.json`);
  });

// ─── generate ─────────────────────────────────────────────────────────────────
program
  .command("generate")
  .description("Generate AI sprites from OpenPose frames using ComfyUI ControlNet")
  .argument("<frames-dir>", "Directory containing frame_N.png (OpenPose output)")
  .requiredOption("--model <name>", "ComfyUI checkpoint filename (e.g. v1-5-pruned.safetensors)")
  .requiredOption("--controlnet <name>", "ControlNet model filename (e.g. control_v11p_sd15_openpose.pth)")
  .requiredOption("--prompt <text>", "Positive prompt for AI generation")
  .option("--negative <text>", "Negative prompt", "lowres, blurry, bad anatomy, extra limbs, watermark")
  .option("--strength <n>", "ControlNet strength", "1.0")
  .option("--width <n>", "Output width px", "512")
  .option("--height <n>", "Output height px", "1024")
  .option("--steps <n>", "Sampling steps", "20")
  .option("--cfg <n>", "CFG scale", "7")
  .option("--seed <n>", "Base seed (incremented per frame; random if omitted)")
  .option("--sampler <name>", "Sampler name", "euler")
  .option("--scheduler <name>", "Scheduler name", "normal")
  .option("--comfyui <url>", "ComfyUI base URL (submit + collect when provided)", "http://127.0.0.1:8188")
  .option("--workflow-out <dir>", "Save per-frame workflow JSONs to this directory")
  .option("-o, --output <dir>", "Output directory for generated images", "./generated")
  .action(async (framesDir: string, opts: {
    model: string; controlnet: string; prompt: string; negative: string;
    strength: string; width: string; height: string;
    steps: string; cfg: string; seed?: string;
    sampler: string; scheduler: string;
    comfyui: string; workflowOut?: string; output: string;
  }) => {
    const outDir = resolve(opts.output);

    // Probe ComfyUI reachability; proceed without submission if unreachable
    let comfyUrl: string | undefined = opts.comfyui;
    try {
      const probe = await fetch(`${comfyUrl}/system_stats`, { signal: AbortSignal.timeout(3000) });
      if (!probe.ok) throw new Error(`status ${probe.status}`);
      console.log(`ComfyUI: ${comfyUrl} ✓`);
    } catch {
      console.warn(`ComfyUI unreachable at ${comfyUrl} — saving workflow JSONs only`);
      comfyUrl = undefined;
    }

    if (!opts.workflowOut && !comfyUrl) {
      console.error("Provide --workflow-out <dir> or ensure ComfyUI is running at --comfyui <url>");
      process.exit(1);
    }

    const result = await generateSprites({
      framesDir:         resolve(framesDir),
      outputDir:         outDir,
      prompt:            opts.prompt,
      negativePrompt:    opts.negative,
      model:             opts.model,
      controlnet:        opts.controlnet,
      controlnetStrength: parseFloat(opts.strength),
      width:             parseInt(opts.width, 10),
      height:            parseInt(opts.height, 10),
      steps:             parseInt(opts.steps, 10),
      cfg:               parseFloat(opts.cfg),
      seed:              opts.seed ? parseInt(opts.seed, 10) : undefined,
      sampler:           opts.sampler,
      scheduler:         opts.scheduler,
      comfyUrl,
      workflowOut:       opts.workflowOut ? resolve(opts.workflowOut) : undefined,
    });

    if (result.workflowPaths.length > 0) {
      console.log(`\nWorkflows: ${result.workflowPaths.length} → ${opts.workflowOut}`);
    }
    if (result.generatedPaths.length > 0) {
      console.log(`Generated: ${result.generatedPaths.length} → ${outDir}`);
    }
  });

program.parse();
