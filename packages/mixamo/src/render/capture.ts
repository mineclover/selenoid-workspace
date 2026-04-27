import puppeteer, { type Browser, type Page } from "puppeteer";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { startRenderServer } from "./server.js";

export interface FbxCaptureOptions {
  charPath: string;
  animPath?: string;
  outputDir: string;
  frames: number;
  frameWidth?: number;
  frameHeight?: number;
  view?: "side" | "front" | "back";
  bgColor?: string;
  frustumHeight?: number;
  headless?: boolean;
  mode?: "3d" | "openpose";   // openpose: render COCO-18 stick figure
}

export interface FbxCaptureResult {
  framePaths: string[];
  frameWidth: number;
  frameHeight: number;
  duration: number;
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

// Seek and capture — calls window.__hf.getFrame() which returns the right canvas
// (OpenPose 2D canvas in openpose mode, WebGL canvas otherwise)
async function captureFrame(page: Page, t: number, outPath: string): Promise<void> {
  const dataUrl = await page.evaluate((seekT: number) => {
    const hf = (window as unknown as { __hf: { seek(t: number): void; getFrame(): string } }).__hf;
    hf.seek(seekT);
    return hf.getFrame();
  }, t);

  const base64 = dataUrl.replace(/^data:image\/png;base64,/, "");
  writeFileSync(outPath, Buffer.from(base64, "base64"));
}

export async function captureFbx(opts: FbxCaptureOptions): Promise<FbxCaptureResult> {
  const {
    charPath, animPath, outputDir, frames,
    frameWidth  = 512,
    frameHeight = 1024,
    view        = "side",
    bgColor     = "#00FF00",
    frustumHeight,
    headless    = true,
    mode        = "3d",
  } = opts;

  mkdirSync(outputDir, { recursive: true });

  const renderServer = await startRenderServer({ bgColor, view, frustumHeight });
  const baseUrl = renderServer.viewerUrl(charPath, { charPath, animPath, view, bg: bgColor });
  const pageUrl = mode === "openpose"
    ? baseUrl + "&mode=openpose"
    : baseUrl;

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

  // Pipe browser console to Node stdout for debugging
  page.on("console", msg => console.log(`[browser ${msg.type()}] ${msg.text()}`));
  page.on("pageerror", err => console.error(`[browser error] ${err.message}`));

  try {
    console.log(`[render] loading viewer...`);
    await page.goto(pageUrl, { waitUntil: "networkidle2", timeout: 60_000 });

    console.log("[render] waiting for FBX to load...");
    const duration = await waitForFbx(page);
    console.log(`[render] FBX ready — animation duration: ${duration.toFixed(3)}s`);

    for (let i = 0; i < frames; i++) {
      // Distribute frames evenly across the animation duration
      const t = frames === 1 ? 0 : (i / (frames - 1)) * duration;
      const outPath = join(outputDir, `frame_${String(i).padStart(2, "0")}.png`);
      await captureFrame(page, t, outPath);
      console.log(`[render] frame ${i + 1}/${frames} t=${t.toFixed(3)}s → ${outPath}`);
      framePaths.push(outPath);
    }
  } finally {
    await browser.close();
    renderServer.close();
  }

  return { framePaths, frameWidth, frameHeight, duration: 0 };
}
