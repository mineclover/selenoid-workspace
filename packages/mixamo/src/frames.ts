import sharp from "sharp";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readdirSync, existsSync } from "node:fs";
import { join, extname } from "node:path";
import type { CaptureResult } from "./types.js";

const execFileAsync = promisify(execFile);

// Remove chroma-key background (default: #00FF00 green)
export async function removeBackground(
  inputPath: string,
  outputPath: string,
  color = "#00FF00",
  fuzz = 12,
): Promise<void> {
  await execFileAsync("magick", [
    inputPath,
    "-fuzz", `${fuzz}%`,
    "-transparent", color,
    outputPath,
  ]);
}

// Crop a single frame from a sprite sheet
export async function cropFrame(
  sheetPath: string,
  outputPath: string,
  x: number,
  y: number,
  width: number,
  height: number,
): Promise<void> {
  await sharp(sheetPath)
    .extract({ left: x, top: y, width, height })
    .png()
    .toFile(outputPath);
}

// Extract all frames from a grid sprite sheet
export async function extractFrames(
  sheetPath: string,
  outputDir: string,
  cols: number,
  rows: number,
  frameWidth: number,
  frameHeight: number,
  bgColor = "#00FF00",
  fuzz = 12,
): Promise<string[]> {
  const paths: string[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      const tmpPath  = join(outputDir, `frame_${String(idx).padStart(2, "0")}_raw.png`);
      const finalPath = join(outputDir, `frame_${String(idx).padStart(2, "0")}.png`);

      await cropFrame(sheetPath, tmpPath, c * frameWidth, r * frameHeight, frameWidth, frameHeight);
      await removeBackground(tmpPath, finalPath, bgColor, fuzz);
      paths.push(finalPath);
    }
  }
  return paths;
}

// Assemble individual frame PNGs into a horizontal strip
export async function assembleStrip(
  framePaths: string[],
  outputPath: string,
): Promise<void> {
  await execFileAsync("magick", [...framePaths, "+append", outputPath]);
}

// Load frame PNGs from a directory sorted by name
export function loadFramePaths(dir: string, pattern = /^frame_\d+\.png$/i): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(f => pattern.test(f) && extname(f).toLowerCase() === ".png")
    .sort()
    .map(f => join(dir, f));
}

// Full pipeline: grid sheet → individual frames → strip
export async function sheetToStrip(opts: {
  sheetPath: string;
  outputDir: string;
  stripPath: string;
  cols: number;
  rows: number;
  frameWidth: number;
  frameHeight: number;
  bgColor?: string;
  fuzz?: number;
}): Promise<CaptureResult> {
  const { cols, rows, frameWidth, frameHeight } = opts;

  console.log(`[frames] extracting ${cols * rows} frames from ${opts.sheetPath}`);
  const framePaths = await extractFrames(
    opts.sheetPath, opts.outputDir,
    cols, rows, frameWidth, frameHeight,
    opts.bgColor, opts.fuzz,
  );

  console.log(`[frames] assembling strip → ${opts.stripPath}`);
  await assembleStrip(framePaths, opts.stripPath);

  return {
    frames: framePaths.map((path, index) => ({ index, path, timeMs: 0 })),
    frameWidth,
    frameHeight,
    stripPath: opts.stripPath,
  };
}
