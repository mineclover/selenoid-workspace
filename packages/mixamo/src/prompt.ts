import type { PromptOptions, GeneratedPrompt } from "./types.js";

// Compute best aspect ratio string for the sprite strip
function aspectRatio(frameCount: number, frameWidth: number, frameHeight: number): string {
  const totalW = frameCount * frameWidth;
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const g = gcd(totalW, frameHeight);
  return `${totalW / g}:${frameHeight / g}`;
}

export function buildPrompt(opts: PromptOptions): GeneratedPrompt {
  const {
    character,
    animation,
    frameCount,
    frameWidth,
    frameHeight,
    style = "flat 2D anime",
    background = "solid bright green (#00FF00)",
  } = opts;

  const totalW = frameCount * frameWidth;
  const ar = aspectRatio(frameCount, frameWidth, frameHeight);

  const prompt = [
    `A ${style} sprite sheet of ${character},`,
    `horizontal strip layout with exactly ${frameCount} frames,`,
    `showing ${animation} animation sequence,`,
    `side view, full body visible in each frame,`,
    `clean black outlines, consistent character design across all frames,`,
    `${background} background,`,
    `${frameCount} animation frames perfectly aligned side-by-side in a single row,`,
    `no text, no watermark, no borders between frames`,
  ].join(" ");

  const negative_prompt = [
    "3D, realistic, photorealistic, vertical layout, grid layout,",
    "multiple rows, misaligned frames, background variation,",
    "text, watermark, signature, logo, frame borders, drop shadow",
  ].join(" ");

  return {
    prompt,
    negative_prompt,
    aspect_ratio: ar,
    recommended_size: `${totalW}x${frameHeight}`,
  };
}

export function printPrompt(p: GeneratedPrompt): void {
  console.log("\n─── AI Generation Prompt ──────────────────────────────");
  console.log("prompt:");
  console.log(`  ${p.prompt}\n`);
  console.log("negative_prompt:");
  console.log(`  ${p.negative_prompt}\n`);
  console.log(`aspect_ratio:      ${p.aspect_ratio}`);
  console.log(`recommended_size:  ${p.recommended_size}`);
  console.log("────────────────────────────────────────────────────────\n");
}
