import puppeteer, { type Browser, type Page } from "puppeteer";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { CaptureOptions, CapturedFrame, CaptureResult } from "./types.js";

const MIXAMO_URL = "https://www.mixamo.com/";

// Wait for Mixamo's 3D viewport (Three.js canvas) to be ready
async function waitForViewport(page: Page, timeoutMs = 30_000): Promise<void> {
  await page.waitForSelector("canvas", { timeout: timeoutMs });
  // Wait for WebGL context to initialize
  await page.waitForFunction(
    () => {
      const canvas = document.querySelector("canvas");
      if (!canvas) return false;
      const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
      return gl !== null;
    },
    { timeout: timeoutMs }
  );
}

// Set canvas background color via CSS overlay (doesn't affect WebGL render)
// For chroma-key green background, we patch the canvas's clearColor via CDP
async function setBackground(page: Page, color: string): Promise<void> {
  // Inject a style that places a solid color div behind the canvas
  await page.evaluate((bg: string) => {
    const existing = document.getElementById("__mixamo_bg__");
    if (existing) { existing.style.background = bg; return; }
    const div = document.createElement("div");
    div.id = "__mixamo_bg__";
    div.style.cssText = `
      position: fixed; inset: 0; z-index: 0;
      background: ${bg}; pointer-events: none;
    `;
    document.body.prepend(div);
  }, color);
}

// Capture a single frame from the Mixamo canvas via CDP screenshot
async function captureCanvasFrame(
  page: Page,
  index: number,
  outputDir: string,
  frameWidth: number,
  frameHeight: number,
): Promise<CapturedFrame> {
  const path = join(outputDir, `frame_${String(index).padStart(2, "0")}.png`);
  const timeMs = Date.now();

  // Use CDP to capture just the canvas element area
  const canvas = await page.$("canvas");
  if (!canvas) throw new Error("Canvas element not found");

  const box = await canvas.boundingBox();
  if (!box) throw new Error("Could not get canvas bounding box");

  await page.screenshot({
    path,
    clip: {
      x: Math.round(box.x),
      y: Math.round(box.y),
      width: Math.round(box.width),
      height: Math.round(box.height),
    },
    type: "png",
  });

  return { index, path, timeMs };
}

// Seek animation to a specific normalized time (0.0 - 1.0) via Mixamo's player API
async function seekAnimation(page: Page, normalizedTime: number): Promise<void> {
  await page.evaluate((t: number) => {
    // Mixamo exposes animation player on window (internal API — may change)
    const w = window as unknown as Record<string, unknown>;
    const player = w["mixamoPlayer"] ?? w["player"];
    if (player && typeof (player as Record<string, unknown>)["seek"] === "function") {
      (player as { seek: (t: number) => void }).seek(t);
      return;
    }
    // Fallback: manipulate the timeline scrubber DOM element
    const scrubber = document.querySelector<HTMLInputElement>('input[type="range"]');
    if (scrubber) {
      const min = parseFloat(scrubber.min || "0");
      const max = parseFloat(scrubber.max || "1");
      scrubber.value = String(min + t * (max - min));
      scrubber.dispatchEvent(new Event("input", { bubbles: true }));
      scrubber.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }, normalizedTime);

  // Brief wait for WebGL to re-render at the new pose
  await new Promise((r) => setTimeout(r, 150));
}

export async function captureMixamo(opts: CaptureOptions): Promise<CaptureResult> {
  const {
    frames,
    outputDir,
    frameWidth = 512,
    frameHeight = 1024,
    background = "#00FF00",
    headless = false,
  } = opts;

  mkdirSync(outputDir, { recursive: true });

  const browser: Browser = await puppeteer.launch({
    headless,
    defaultViewport: { width: frameWidth, height: frameHeight },
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--enable-webgl",
      "--ignore-gpu-blocklist",
      "--use-gl=swiftshader",
    ],
  });

  const page = await browser.newPage();

  try {
    console.log(`[mixamo] navigating to ${opts.url ?? MIXAMO_URL}`);
    await page.goto(opts.url ?? MIXAMO_URL, { waitUntil: "networkidle2" });

    console.log("[mixamo] waiting for 3D viewport...");
    await waitForViewport(page);

    if (background) await setBackground(page, background);

    const captured: CapturedFrame[] = [];
    for (let i = 0; i < frames; i++) {
      const t = frames === 1 ? 0 : i / (frames - 1);
      console.log(`[mixamo] frame ${i + 1}/${frames} (t=${t.toFixed(3)})`);
      await seekAnimation(page, t);
      const frame = await captureCanvasFrame(page, i, outputDir, frameWidth, frameHeight);
      captured.push(frame);
    }

    console.log(`[mixamo] captured ${captured.length} frames → ${outputDir}`);
    return { frames: captured, frameWidth, frameHeight };
  } finally {
    await browser.close();
  }
}
