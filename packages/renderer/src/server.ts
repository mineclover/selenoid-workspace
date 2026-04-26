#!/usr/bin/env node
/**
 * Hyperframes Render Server — custom HTML edition
 *
 * The page must implement:
 *   window.__hf = { duration: number, seek(t: number): void }
 *
 * window.__assets is auto-injected for every image/sequence in `files`:
 *
 *   Sprite sheet (strip or grid):
 *     window.__assets['sprite.png'] = {
 *       type: "sprite",
 *       src: "./sprite.png",
 *       width, height,            // full sheet dimensions
 *       frameWidth, frameHeight,  // one cut
 *       rows, cols,               // grid dimensions (rows=1 for strip)
 *       frames,                   // total frame count
 *       renderMode,               // "css" | "canvas"
 *     }
 *
 *   Frame sequence (frame_000.png, frame_001.png …):
 *     window.__assets['frame'] = {
 *       type: "sequence",
 *       frames,
 *       frameWidth, frameHeight,
 *       srcs: ["./frame_000.png", …],
 *       renderMode: "img",
 *     }
 *
 * Routes:
 *   GET  /health
 *   POST /render  { html, files?, meta?, fps?, quality?, format?, width?, height? }
 *   GET  /outputs/:token
 */

import { createServer } from "node:http";
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join, extname, basename } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import crypto from "node:crypto";
import {
  acquireBrowser,
  buildChromeArgs,
  releaseBrowser,
  createCaptureSession,
  initializeSession,
  captureFrame,
  closeCaptureSession,
} from "@hyperframes/engine";

const execFileAsync = promisify(execFile);

const PORT = parseInt(process.env.PORT ?? "9847", 10);
const RENDERS_DIR = process.env.RENDERS_DIR ?? join(tmpdir(), "hf-renders");
mkdirSync(RENDERS_DIR, { recursive: true });

// ─── Size limits ──────────────────────────────────────────────────────────────

const MAX_BODY_BYTES    = 100 * 1024 * 1024;  // 100 MB  total request
const MAX_FILE_BYTES    =  20 * 1024 * 1024;  // 20 MB   per decoded file
const MAX_TOTAL_FILES_BYTES = 200 * 1024 * 1024; // 200 MB  sum of all files

// renderMode threshold: CSS compositing path (no texture limit)
// vs Canvas GPU path (8192×8192 limit under SwiftShader)
const CANVAS_THRESHOLD_PX = 512; // frameWidth >= this → renderMode:"canvas"

// ─── Token store ─────────────────────────────────────────────────────────────

const outputTokens = new Map<string, { path: string; expiresMs: number }>();
setInterval(() => {
  const now = Date.now();
  for (const [token, entry] of outputTokens) {
    if (entry.expiresMs < now) outputTokens.delete(token);
  }
}, 60_000);

// ─── Image dimension parsing ──────────────────────────────────────────────────

interface ImageSize { width: number; height: number }

function readImageSize(buf: Buffer, ext: string): ImageSize | null {
  const e = ext.toLowerCase().replace(".", "");
  if (e === "png") {
    if (buf.length < 24 || buf[0] !== 0x89 || buf[1] !== 0x50) return null;
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (e === "jpg" || e === "jpeg") {
    let i = 2;
    while (i < buf.length - 8) {
      if (buf[i] !== 0xff) break;
      const marker = buf[i + 1];
      const len = buf.readUInt16BE(i + 2);
      if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) ||
          (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
        return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      }
      i += 2 + len;
    }
    return null;
  }
  if (e === "gif") {
    if (buf.length < 10) return null;
    return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
  }
  if (e === "webp") {
    if (buf.length < 30) return null;
    if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WEBP") return null;
    const t = buf.toString("ascii", 12, 16);
    if (t === "VP8 ") return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    if (t === "VP8L") {
      const bits = buf.readUInt32LE(21);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    return null;
  }
  return null;
}

// ─── Asset types ──────────────────────────────────────────────────────────────

interface FileMeta {
  frameWidth?: number;
  frameHeight?: number;
  rows?: number;           // grid rows (omit or 1 = strip)
  renderMode?: "css" | "canvas" | "img";
}

interface SpriteAsset {
  type: "sprite";
  src: string;
  width: number;
  height: number;
  frameWidth: number;
  frameHeight: number;
  rows: number;
  cols: number;
  frames: number;
  renderMode: "css" | "canvas";
}

interface SequenceAsset {
  type: "sequence";
  frames: number;
  frameWidth: number;
  frameHeight: number;
  srcs: string[];
  renderMode: "img";
}

type AssetInfo = SpriteAsset | SequenceAsset;

// ─── Sequence detection ───────────────────────────────────────────────────────
// Groups files matching  {prefix}_{NNN}.ext  or  {prefix}{NNN}.ext  (2+ digits)

interface SequenceGroup {
  prefix: string;
  ext: string;
  files: Array<{ name: string; index: number }>;
}

function detectSequences(names: string[]): Map<string, SequenceGroup> {
  const seqPattern = /^(.+?)_?(\d{2,})\.(png|jpe?g|gif|webp)$/i;
  const groups = new Map<string, SequenceGroup>();

  for (const name of names) {
    const m = name.match(seqPattern);
    if (!m) continue;
    const [, prefix, numStr, ext] = m;
    const key = `${prefix}.${ext.toLowerCase()}`;
    if (!groups.has(key)) groups.set(key, { prefix, ext: ext.toLowerCase(), files: [] });
    groups.get(key)!.files.push({ name, index: parseInt(numStr, 10) });
  }

  // Only treat as sequence if ≥ 2 files
  for (const [key, g] of groups) {
    if (g.files.length < 2) groups.delete(key);
    else g.files.sort((a, b) => a.index - b.index);
  }
  return groups;
}

// ─── window.__assets script builder ──────────────────────────────────────────

function buildAssetsScript(
  files: Record<string, string>,
  meta: Record<string, FileMeta>,
): string {
  const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp"]);
  const assets: Record<string, AssetInfo> = {};
  const fileNames = Object.keys(files);

  // Detect frame sequences first
  const sequences = detectSequences(fileNames);
  const seqFileNames = new Set<string>();
  for (const [key, seq] of sequences) {
    seq.files.forEach(f => seqFileNames.add(f.name));
    const m = meta[key] ?? {};
    // Size from first frame
    const firstBuf = Buffer.from(files[seq.files[0].name], "base64");
    const firstExt = seq.files[0].name.split(".").pop() ?? "png";
    const size = readImageSize(firstBuf, firstExt) ?? { width: 0, height: 0 };
    const fw = m.frameWidth ?? size.width;
    const fh = m.frameHeight ?? size.height;
    assets[key] = {
      type: "sequence",
      frames: seq.files.length,
      frameWidth: fw,
      frameHeight: fh,
      srcs: seq.files.map(f => `./${f.name}`),
      renderMode: "img",
    };
  }

  // Process sprite sheets (non-sequence images)
  for (const [name, b64] of Object.entries(files)) {
    if (seqFileNames.has(name)) continue;
    const ext = extname(name).slice(1).toLowerCase();
    if (!IMAGE_EXTS.has(ext)) continue;

    const buf = Buffer.from(b64, "base64");
    const size = readImageSize(buf, ext);
    if (!size) continue;

    const m = meta[name] ?? {};
    const rows = Math.max(1, m.rows ?? 1);
    const fw = m.frameWidth ?? size.width;
    const fh = m.frameHeight ?? size.height;
    const cols = Math.max(1, Math.round(size.width / fw));
    const frames = rows * cols;

    const rm: "css" | "canvas" =
      m.renderMode === "canvas" ? "canvas"
      : m.renderMode === "css"  ? "css"
      : fw >= CANVAS_THRESHOLD_PX ? "canvas" : "css";

    assets[name] = { type: "sprite", src: `./${name}`, width: size.width, height: size.height, frameWidth: fw, frameHeight: fh, rows, cols, frames, renderMode: rm };
  }

  if (Object.keys(assets).length === 0) return "";
  return `<script>window.__assets=${JSON.stringify(assets)};</script>`;
}

function injectScript(html: string, scriptTag: string): string {
  if (!scriptTag) return html;
  if (/<head[\s>]/i.test(html)) return html.replace(/(<head[^>]*>)/i, `$1\n${scriptTag}`);
  if (/<body[\s>]/i.test(html)) return html.replace(/(<body[^>]*>)/i, `$1\n${scriptTag}`);
  return scriptTag + "\n" + html;
}

// ─── Request types ────────────────────────────────────────────────────────────

interface RenderRequest {
  html: string;
  files?: Record<string, string>;
  meta?: Record<string, FileMeta>;
  fps?: number;
  quality?: "draft" | "standard" | "high";
  format?: "mp4" | "webm";
  width?: number;
  height?: number;
}

const QUALITY_CRF: Record<string, number> = { draft: 28, standard: 18, high: 15 };

// ─── Render ───────────────────────────────────────────────────────────────────

async function renderHtml(req: RenderRequest): Promise<string> {
  const fps     = req.fps     ?? 30;
  const quality = req.quality ?? "standard";
  const format  = req.format  ?? "mp4";
  const width   = req.width   ?? 1280;
  const height  = req.height  ?? 720;
  const files   = req.files   ?? {};
  const meta    = req.meta    ?? {};

  // ── B: File size validation ──
  let totalBytes = 0;
  for (const [name, b64] of Object.entries(files)) {
    const decoded = Math.ceil(b64.length * 0.75);
    if (decoded > MAX_FILE_BYTES) {
      throw new Error(`File "${name}" is ${Math.round(decoded / 1024 / 1024)}MB — exceeds 20MB per-file limit. Split into smaller sheets or use a sequence.`);
    }
    totalBytes += decoded;
  }
  if (totalBytes > MAX_TOTAL_FILES_BYTES) {
    throw new Error(`Total files size ${Math.round(totalBytes / 1024 / 1024)}MB exceeds 200MB limit.`);
  }

  // ── Sheet dimension warnings ──
  for (const [name, b64] of Object.entries(files)) {
    const ext = extname(name).slice(1).toLowerCase();
    if (!["png","jpg","jpeg","gif","webp"].includes(ext)) continue;
    const buf = Buffer.from(b64, "base64");
    const size = readImageSize(buf, ext);
    const m = meta[name] ?? {};
    const fw = m.frameWidth;
    if (size && fw && fw >= CANVAS_THRESHOLD_PX && size.width > 8192) {
      console.warn(`[render] WARNING: "${name}" sheet width ${size.width}px exceeds 8192px Canvas limit. renderMode will be "canvas" but may hit SwiftShader texture cap. Consider using grid layout (rows>1) or a frame sequence.`);
    }
  }

  const workDir = join(tmpdir(), `hf-render-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`);
  mkdirSync(workDir, { recursive: true });

  for (const [name, b64] of Object.entries(files)) {
    const safeName = name.replace(/\.\./g, "").replace(/^\//, "");
    const dir = join(workDir, safeName.includes("/") ? safeName.split("/").slice(0, -1).join("/") : ".");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(workDir, safeName), Buffer.from(b64, "base64"));
  }

  const assetsScript = buildAssetsScript(files, meta);
  const html = injectScript(req.html, assetsScript);
  writeFileSync(join(workDir, "index.html"), html, "utf-8");

  if (assetsScript) {
    // Log asset summary
    const parsed = JSON.parse(assetsScript.replace(/^<script>window.__assets=/, "").replace(";</script>", "")) as Record<string, AssetInfo>;
    for (const [name, a] of Object.entries(parsed)) {
      if (a.type === "sprite") {
        console.log(`[render] sprite "${name}" ${a.width}x${a.height} → ${a.frames}f (${a.rows}r×${a.cols}c @ ${a.frameWidth}x${a.frameHeight}) mode=${a.renderMode}`);
      } else {
        console.log(`[render] sequence "${name}" ${a.frames}f @ ${a.frameWidth}x${a.frameHeight}`);
      }
    }
  }

  const framesDir = join(workDir, "frames");
  mkdirSync(framesDir, { recursive: true });
  const outputPath = join(RENDERS_DIR, `render-${Date.now()}.${format}`);

  const MIME: Record<string, string> = {
    html:"text/html", js:"application/javascript", css:"text/css",
    json:"application/json", png:"image/png", jpg:"image/jpeg",
    jpeg:"image/jpeg", gif:"image/gif", webp:"image/webp",
    svg:"image/svg+xml", woff:"font/woff", woff2:"font/woff2",
  };
  const fileServer = createServer((httpReq, httpRes) => {
    const reqPath = decodeURIComponent(httpReq.url?.split("?")[0] ?? "/");
    const filePath = join(workDir, reqPath === "/" ? "index.html" : reqPath);
    if (existsSync(filePath)) {
      const ext = extname(filePath).slice(1).toLowerCase();
      httpRes.writeHead(200, { "Content-Type": MIME[ext] ?? "application/octet-stream" });
      httpRes.end(readFileSync(filePath));
    } else {
      httpRes.writeHead(404);
      httpRes.end("Not found");
    }
  });

  await new Promise<void>((res) => fileServer.listen(0, "127.0.0.1", res));
  const fileServerPort = (fileServer.address() as { port: number }).port;
  const pageUrl = `http://127.0.0.1:${fileServerPort}/`;

  let session: Awaited<ReturnType<typeof createCaptureSession>> | undefined;
  let browser: Awaited<ReturnType<typeof acquireBrowser>>["browser"] | undefined;
  try {
    const chromeArgs = buildChromeArgs({ width, height });
    const acquired = await acquireBrowser(chromeArgs);
    browser = acquired.browser;
    console.log(`[render] captureMode=${acquired.captureMode} fps=${fps} ${width}x${height}`);

    session = await createCaptureSession(pageUrl, framesDir, {
      width, height, fps, format: "jpeg",
      quality: quality === "draft" ? 60 : quality === "high" ? 92 : 80,
    });
    await initializeSession(session);

    const duration: number = await (session as unknown as {
      page: { evaluate: (fn: () => number) => Promise<number> }
    }).page.evaluate(() => (window as unknown as { __hf: { duration: number } }).__hf.duration);

    const totalFrames = Math.ceil(duration * fps);
    console.log(`[render] duration=${duration}s frames=${totalFrames}`);
    for (let i = 0; i < totalFrames; i++) {
      await captureFrame(session, i, i / fps);
    }
  } finally {
    if (session) await closeCaptureSession(session).catch(() => {});
    if (browser) await releaseBrowser(browser).catch(() => {});
    fileServer.close();
  }

  const crf = QUALITY_CRF[quality] ?? 18;
  await execFileAsync("ffmpeg", [
    "-y", "-framerate", String(fps),
    "-pattern_type", "glob", "-i", join(framesDir, "*.jpg"),
    "-c:v", "libx264", "-crf", String(crf),
    "-pix_fmt", "yuv420p", "-movflags", "+faststart",
    outputPath,
  ]);

  rmSync(workDir, { recursive: true, force: true });
  return outputPath;
}

// ─── HTTP server ──────────────────────────────────────────────────────────────

function parseBody(req: import("node:http").IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let received = 0;
    req.on("data", (chunk: Buffer) => {
      received += chunk.length;
      if (received > MAX_BODY_BYTES) {
        req.destroy();
        reject(new Error(`Request body exceeds ${MAX_BODY_BYTES / 1024 / 1024}MB limit`));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
      catch { reject(new Error("Invalid JSON")); }
    });
    req.on("error", reject);
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  res.setHeader("Content-Type", "application/json");

  if (req.method === "GET" && url.pathname === "/health") {
    res.end(JSON.stringify({ status: "ok", uptime: Math.round(process.uptime()) }));
    return;
  }

  if (req.method === "GET" && url.pathname.startsWith("/outputs/")) {
    const token = url.pathname.slice("/outputs/".length);
    const entry = outputTokens.get(token);
    if (!entry || !existsSync(entry.path)) {
      res.writeHead(404);
      res.end(JSON.stringify({ error: "Not found or expired" }));
      return;
    }
    const data = readFileSync(entry.path);
    res.writeHead(200, { "Content-Type": "video/mp4", "Content-Disposition": 'attachment; filename="render.mp4"' });
    res.end(data);
    return;
  }

  if (req.method === "POST" && url.pathname === "/render") {
    const t0 = Date.now();
    let body: unknown;
    try { body = await parseBody(req); }
    catch (e) {
      res.writeHead(413);
      res.end(JSON.stringify({ success: false, error: e instanceof Error ? e.message : "Body parse failed" }));
      return;
    }

    const renderReq = body as RenderRequest;
    if (!renderReq.html || typeof renderReq.html !== "string") {
      res.writeHead(400);
      res.end(JSON.stringify({ success: false, error: "html field required" }));
      return;
    }

    try {
      const outputPath = await renderHtml(renderReq);
      const fileSize = readFileSync(outputPath).length;
      const token = crypto.randomUUID();
      outputTokens.set(token, { path: outputPath, expiresMs: Date.now() + 15 * 60_000 });
      res.writeHead(200);
      res.end(JSON.stringify({ success: true, outputToken: token, outputUrl: `/outputs/${token}`, fileSize, durationMs: Date.now() - t0 }));
    } catch (err) {
      res.writeHead(500);
      res.end(JSON.stringify({ success: false, error: err instanceof Error ? err.message : String(err), durationMs: Date.now() - t0 }));
    }
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: "Not found" }));
});

server.listen(PORT, () => console.log(`[hf-renderer] listening on :${PORT}`));
