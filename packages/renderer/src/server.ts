#!/usr/bin/env node
/**
 * Hyperframes Render Server — custom HTML edition
 *
 * Wraps @hyperframes/engine directly (no producer runtime injection).
 * The page must implement:
 *   window.__hf = { duration: number, seek(t: number): void }
 *
 * Routes:
 *   GET  /health
 *   POST /render  { html, files?, meta?, fps?, quality?, format?, width?, height? }
 *     files: { "sprite.png": "<base64>", ... }
 *     meta:  { "sprite.png": { frameWidth: 80, frameHeight: 80 } }
 *     → injects window.__assets into the page automatically
 *   GET  /outputs/:token
 */

import { createServer } from "node:http";
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join, extname } from "node:path";
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
    if (buf.length < 24) return null;
    // PNG sig (8) + IHDR length (4) + "IHDR" (4) + width (4) + height (4)
    if (buf[0] !== 0x89 || buf[1] !== 0x50) return null;
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (e === "jpg" || e === "jpeg") {
    // Scan for SOF marker
    let i = 2;
    while (i < buf.length - 8) {
      if (buf[i] !== 0xff) break;
      const marker = buf[i + 1];
      const len = buf.readUInt16BE(i + 2);
      // SOF0–SOF3, SOF5–SOF7, SOF9–SOF11, SOF13–SOF15
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
    // RIFF(4) + size(4) + WEBP(4) + VP8 (4) + chunk_size(4) + VP8 frame...
    // VP8 frame: 3-byte header then stride/height at offsets 6-7 (14-bit each)
    if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WEBP") return null;
    const vp8type = buf.toString("ascii", 12, 16);
    if (vp8type === "VP8 ") {
      const b0 = buf[23], b1 = buf[24], b2 = buf[25];
      if (b0 !== 0x9d || b1 !== 0x01 || b2 !== 0x2a) return null;
      return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    }
    if (vp8type === "VP8L") {
      const bits = buf.readUInt32LE(21);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    return null;
  }
  return null;
}

// ─── window.__assets injection ────────────────────────────────────────────────

interface FileMeta {
  frameWidth?: number;
  frameHeight?: number;
}

interface AssetInfo {
  src: string;
  width: number;
  height: number;
  frameWidth: number;
  frameHeight: number;
  frames: number;
}

function buildAssetsScript(
  files: Record<string, string>,
  meta: Record<string, FileMeta>,
): string {
  const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg"]);
  const assets: Record<string, AssetInfo> = {};

  for (const [name, b64] of Object.entries(files)) {
    const ext = extname(name).slice(1).toLowerCase();
    if (!IMAGE_EXTS.has(ext)) continue;

    const buf = Buffer.from(b64, "base64");
    const size = readImageSize(buf, ext);
    if (!size) continue;

    const m = meta[name] ?? {};
    const fw = m.frameWidth ?? size.width;
    const fh = m.frameHeight ?? size.height;

    assets[name] = {
      src: `./${name}`,
      width: size.width,
      height: size.height,
      frameWidth: fw,
      frameHeight: fh,
      frames: Math.round(size.width / fw),
    };
  }

  if (Object.keys(assets).length === 0) return "";
  return `<script>window.__assets=${JSON.stringify(assets)};</script>`;
}

function injectScript(html: string, scriptTag: string): string {
  if (!scriptTag) return html;
  // Inject right after <head> if present, otherwise prepend to <body>, else prepend to all
  if (/<head[\s>]/i.test(html)) return html.replace(/(<head[^>]*>)/i, `$1\n${scriptTag}`);
  if (/<body[\s>]/i.test(html)) return html.replace(/(<body[^>]*>)/i, `$1\n${scriptTag}`);
  return scriptTag + "\n" + html;
}

// ─── Render ───────────────────────────────────────────────────────────────────

interface RenderRequest {
  html: string;
  /** Static assets: { "sprite.png": "<base64>" } — served at ./sprite.png */
  files?: Record<string, string>;
  /** Per-file sprite metadata: { "sprite.png": { frameWidth: 80, frameHeight: 80 } } */
  meta?: Record<string, FileMeta>;
  fps?: number;
  quality?: "draft" | "standard" | "high";
  format?: "mp4" | "webm";
  width?: number;
  height?: number;
}

const QUALITY_CRF: Record<string, number> = { draft: 28, standard: 18, high: 15 };

async function renderHtml(req: RenderRequest): Promise<string> {
  const fps    = req.fps     ?? 30;
  const quality = req.quality ?? "standard";
  const format  = req.format  ?? "mp4";
  const width   = req.width   ?? 1280;
  const height  = req.height  ?? 720;
  const files   = req.files   ?? {};
  const meta    = req.meta    ?? {};

  const workDir = join(tmpdir(), `hf-render-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`);
  mkdirSync(workDir, { recursive: true });

  // Write asset files first (HTML may reference them via ./name)
  for (const [name, b64] of Object.entries(files)) {
    const safeName = name.replace(/\.\./g, "").replace(/^\//, "");
    const fileDir = join(workDir, safeName.includes("/") ? safeName.split("/").slice(0, -1).join("/") : ".");
    mkdirSync(fileDir, { recursive: true });
    writeFileSync(join(workDir, safeName), Buffer.from(b64, "base64"));
  }

  // Build and inject window.__assets script
  const assetsScript = buildAssetsScript(files, meta);
  const html = injectScript(req.html, assetsScript);
  writeFileSync(join(workDir, "index.html"), html, "utf-8");

  if (assetsScript) {
    const names = Object.keys(files).filter(n => /\.(png|jpe?g|gif|webp|svg)$/i.test(n));
    console.log(`[render] assets injected: ${names.join(", ")}`);
  }

  const framesDir = join(workDir, "frames");
  mkdirSync(framesDir, { recursive: true });
  const outputPath = join(RENDERS_DIR, `render-${Date.now()}.${format}`);

  // Minimal file server — serves anything in workDir
  const MIME: Record<string, string> = {
    html: "text/html", js: "application/javascript", css: "text/css",
    json: "application/json", png: "image/png", jpg: "image/jpeg",
    jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
    svg: "image/svg+xml", woff: "font/woff", woff2: "font/woff2",
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
      width, height, fps,
      format: "jpeg",
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
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
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
    catch {
      res.writeHead(400);
      res.end(JSON.stringify({ success: false, error: "Invalid JSON body" }));
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
