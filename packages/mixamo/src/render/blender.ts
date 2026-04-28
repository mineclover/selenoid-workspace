import { spawnSync } from "node:child_process";
import { mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { FbxCaptureOptions, FbxCaptureResult } from "./capture.js";

const BLENDER_CANDIDATES = [
  "/Applications/Blender.app/Contents/MacOS/Blender", // macOS
  "/usr/bin/blender",                                   // Linux system
  "/snap/bin/blender",                                  // Linux snap
];

export function findBlender(customPath?: string): string {
  if (customPath && existsSync(customPath)) return customPath;
  for (const p of BLENDER_CANDIDATES) {
    if (existsSync(p)) return p;
  }
  return "blender"; // fall back to PATH
}

export async function captureWithBlender(
  opts: FbxCaptureOptions & { blenderPath?: string },
): Promise<FbxCaptureResult> {
  const {
    charPath,
    animPath,
    outputDir,
    frames      = 8,
    fps,
    frameWidth  = 512,
    frameHeight = 1024,
    view        = "front",
    normalize   = "global",
    saveJson    = false,
    blenderPath,
  } = opts;

  mkdirSync(outputDir, { recursive: true });

  const scriptPath = join(dirname(fileURLToPath(import.meta.url)), "blender_extract.py");
  if (!existsSync(scriptPath)) {
    throw new Error(`Blender extract script not found: ${scriptPath}`);
  }

  const blender = findBlender(blenderPath);
  console.log(`[blender] ${blender}`);
  console.log(`[blender] char: ${charPath}`);
  if (animPath) console.log(`[blender] anim: ${animPath}`);

  const argsJson = JSON.stringify({
    charPath, animPath, outputDir,
    frames, fps, width: frameWidth, height: frameHeight,
    view, normalize, saveJson,
  });

  const proc = spawnSync(
    blender,
    ["--background", "--python", scriptPath, "--", argsJson],
    { stdio: ["ignore", "pipe", "pipe"], timeout: 10 * 60_000 },
  );

  const stdout = proc.stdout?.toString() ?? "";
  const stderr = proc.stderr?.toString() ?? "";

  // Forward progress lines
  for (const line of stdout.split("\n")) {
    if (line.startsWith("[blender]")) console.log(line);
  }

  if (proc.error) throw new Error(`Failed to spawn Blender: ${proc.error.message}`);
  if (proc.status !== 0) {
    const hint = stderr.split("\n").filter(l => /error|Error/.test(l)).slice(-3).join("\n") || stderr.slice(-300);
    throw new Error(`Blender exited ${proc.status}:\n${hint}`);
  }

  const resultLine = stdout.split("\n").find(l => l.startsWith("RESULT:"));
  if (!resultLine) {
    throw new Error(`Blender produced no RESULT line.\nstderr:\n${stderr.slice(-500)}`);
  }

  const result = JSON.parse(resultLine.slice("RESULT:".length)) as {
    framePaths: string[];
    jsonPaths:  string[];
    frameWidth: number;
    frameHeight: number;
    duration: number;
    error?: string;
  };

  if (result.error) throw new Error(`Blender script error: ${result.error}`);

  return {
    framePaths:  result.framePaths,
    jsonPaths:   result.jsonPaths,
    frameWidth:  result.frameWidth,
    frameHeight: result.frameHeight,
    duration:    result.duration,
  };
}
