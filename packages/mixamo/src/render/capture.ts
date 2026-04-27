import puppeteer, { type Browser, type Page } from "puppeteer";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { startRenderServer } from "./server.js";

export interface FbxCaptureOptions {
  charPath: string;
  animPath?: string;
  outputDir: string;
  frames?: number;            // explicit frame count (ignored when fps is set)
  fps?: number;               // capture at this rate; total frames = ceil(duration * fps)
  frameWidth?: number;
  frameHeight?: number;
  view?: "side" | "front" | "back";
  bgColor?: string;
  frustumHeight?: number;
  headless?: boolean;
  mode?: "3d" | "openpose";        // openpose: render COCO-18 stick figure
  normalize?: "global" | "frame"; // OpenPose: global=fixed camera, frame=always-fill (default: global)
  saveJson?: boolean;              // save OpenPose JSON keypoints alongside each PNG (openpose mode only)
  videoPath?: string;              // if set, assemble frames into MP4 with ffmpeg
}

export interface FbxCaptureResult {
  framePaths: string[];
  jsonPaths: string[];
  frameWidth: number;
  frameHeight: number;
  duration: number;
  videoPath?: string;
}

// Poll until window.__fbxReady or __fbxError is set
async function waitForFbx(page: Page, timeoutMs = 30_000): Promise<number> {
  const result = await page.waitForFunction(
    () => {
      const w = window as unknown as { __fbxReady?: boolean; __fbxError?: string };
      if (w.__fbxError) throw new Error(w.__fbxError);
      return w.__fbxReady ? (window as unknown as { __hf: { duration: number } }).__hf.duration : false;
    },
    { timeout: timeoutMs, polling: 200 }
  );
  return (await result.jsonValue()) as number;
}

interface HfKeypoints {
  pose_keypoints_2d: number[];
  hand_right_keypoints_2d: number[];
  hand_left_keypoints_2d: number[];
  face_keypoints_2d: number[];
}

// Seek, capture PNG, and optionally collect keypoints — single evaluate call.
async function captureFrame(
  page: Page, t: number, pngPath: string, withJson: boolean
): Promise<HfKeypoints | null> {
  const result = await page.evaluate((seekT: number, wantJson: boolean) => {
    const hf = (window as unknown as {
      __hf: {
        seek(t: number): void;
        getFrame(): string;
        getKeypoints?(): HfKeypoints | null;
      }
    }).__hf;
    hf.seek(seekT);
    return {
      frame:     hf.getFrame(),
      keypoints: wantJson && hf.getKeypoints ? hf.getKeypoints() : null,
    };
  }, t, withJson) as { frame: string; keypoints: HfKeypoints | null };

  const base64 = result.frame.replace(/^data:image\/png;base64,/, "");
  writeFileSync(pngPath, Buffer.from(base64, "base64"));
  return result.keypoints;
}

export async function captureFbx(opts: FbxCaptureOptions): Promise<FbxCaptureResult> {
  const {
    charPath, animPath, outputDir,
    frameWidth  = 512,
    frameHeight = 1024,
    view        = "side",
    bgColor     = "#00FF00",
    frustumHeight,
    headless    = true,
    mode        = "3d",
    normalize   = "global",
    saveJson    = false,
    videoPath,
  } = opts;

  mkdirSync(outputDir, { recursive: true });

  const renderServer = await startRenderServer({ bgColor, view, frustumHeight });
  const baseUrl = renderServer.viewerUrl(charPath, { charPath, animPath, view, bg: bgColor });
  const pageUrl = baseUrl
    + (mode === "openpose" ? "&mode=openpose" : "")
    + (normalize === "frame" ? "&normalize=frame" : "");

  console.log(`[render] char: ${charPath}`);
  if (animPath) console.log(`[render] anim: ${animPath}`);
  console.log(`[render] server: http://127.0.0.1:${renderServer.port}`);

  const browser: Browser = await puppeteer.launch({
    headless,
    defaultViewport: { width: frameWidth, height: frameHeight },
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--enable-webgl",
      "--ignore-gpu-blocklist",
      "--enable-features=Vulkan",
    ],
  });

  const page: Page = await browser.newPage();
  const framePaths: string[] = [];
  const jsonPaths:  string[] = [];

  page.on("console", msg => console.log(`[browser ${msg.type()}] ${msg.text()}`));
  page.on("pageerror", err => console.error(`[browser error] ${err.message}`));

  let duration = 0;

  try {
    console.log(`[render] loading viewer...`);
    await page.goto(pageUrl, { waitUntil: "networkidle2", timeout: 60_000 });

    console.log("[render] waiting for FBX to load...");
    duration = await waitForFbx(page);
    console.log(`[render] FBX ready — animation duration: ${duration.toFixed(3)}s`);

    // fps mode: evenly-spaced timestamps at 1/fps intervals
    // frames mode: N snapshots distributed across [0, duration]
    const fps = opts.fps;
    const totalFrames = fps
      ? Math.ceil(duration * fps)
      : (opts.frames ?? 8);

    const pad = String(totalFrames - 1).length;

    const withJson = saveJson && mode === "openpose";

    for (let i = 0; i < totalFrames; i++) {
      const t = fps ? i / fps : (totalFrames === 1 ? 0 : (i / (totalFrames - 1)) * duration);
      const stem    = `frame_${String(i).padStart(pad, "0")}`;
      const pngPath = join(outputDir, `${stem}.png`);
      const kpData  = await captureFrame(page, t, pngPath, withJson);
      if (i % 10 === 0 || i === totalFrames - 1) {
        console.log(`[render] frame ${i + 1}/${totalFrames} t=${t.toFixed(3)}s`);
      }
      framePaths.push(pngPath);

      if (kpData) {
        const jsonPath = join(outputDir, `${stem}_keypoints.json`);
        const payload = {
          version: 1.3,
          people: [{
            person_id: [-1],
            pose_keypoints_2d:       kpData.pose_keypoints_2d,
            face_keypoints_2d:       kpData.face_keypoints_2d,
            hand_left_keypoints_2d:  kpData.hand_left_keypoints_2d,
            hand_right_keypoints_2d: kpData.hand_right_keypoints_2d,
          }],
        };
        writeFileSync(jsonPath, JSON.stringify(payload, null, 2));
        jsonPaths.push(jsonPath);
      }
    }
  } finally {
    await browser.close();
    renderServer.close();
  }

  let outVideoPath: string | undefined;
  if (videoPath && framePaths.length > 0) {
    outVideoPath = assembleVideo(framePaths, videoPath, opts.fps ?? 30, frameWidth, frameHeight);
  }

  return { framePaths, jsonPaths, frameWidth, frameHeight, duration, videoPath: outVideoPath };
}

function assembleVideo(
  framePaths: string[],
  outPath: string,
  fps: number,
  width: number,
  height: number,
): string {
  // ffmpeg requires even dimensions for yuv420p
  const w = width  % 2 === 0 ? width  : width  - 1;
  const h = height % 2 === 0 ? height : height - 1;

  // Derive glob pattern from first frame path (frame_0000.png → frame_%04d.png)
  const first = framePaths[0];
  const pad = first.match(/frame_(\d+)\.png$/)?.[1].length ?? 2;
  const pattern = first.replace(/frame_\d+\.png$/, `frame_%0${pad}d.png`);

  console.log(`[render] assembling MP4 — ${framePaths.length} frames @ ${fps}fps → ${outPath}`);

  const result = spawnSync("ffmpeg", [
    "-y",
    "-framerate", String(fps),
    "-i", pattern,
    "-vf", `scale=${w}:${h}`,
    "-c:v", "libx264",
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    outPath,
  ], { stdio: ["ignore", "pipe", "pipe"] });

  if (result.status !== 0) {
    const stderr = result.stderr?.toString() ?? "";
    throw new Error(`ffmpeg failed (exit ${result.status}):\n${stderr}`);
  }

  console.log(`[render] video: ${outPath}`);
  return outPath;
}
