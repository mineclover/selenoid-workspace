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
 *   POST /render   { html, fps?, quality?, format?, width?, height? }
 *   GET  /outputs/:token
 */

import { createServer } from "node:http";
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir, homedir } from "node:os";
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

// Token store for output file downloads (15 min TTL)
const outputTokens = new Map<string, { path: string; expiresMs: number }>();
setInterval(() => {
  const now = Date.now();
  for (const [token, entry] of outputTokens) {
    if (entry.expiresMs < now) outputTokens.delete(token);
  }
}, 60_000);

interface RenderRequest {
  html: string;
  fps?: number;
  quality?: "draft" | "standard" | "high";
  format?: "mp4" | "webm";
  width?: number;
  height?: number;
}

const QUALITY_CRF: Record<string, number> = { draft: 28, standard: 18, high: 15 };

async function renderHtml(req: RenderRequest): Promise<string> {
  const fps = req.fps ?? 30;
  const quality = req.quality ?? "standard";
  const format = req.format ?? "mp4";
  const width = req.width ?? 1280;
  const height = req.height ?? 720;

  // Write HTML to temp dir
  const workDir = join(tmpdir(), `hf-render-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`);
  mkdirSync(workDir, { recursive: true });
  const htmlPath = join(workDir, "index.html");
  writeFileSync(htmlPath, req.html, "utf-8");

  const framesDir = join(workDir, "frames");
  mkdirSync(framesDir, { recursive: true });

  const outputPath = join(RENDERS_DIR, `render-${Date.now()}.${format}`);

  // Serve HTML via a minimal HTTP file server
  const fileServer = createServer((httpReq, httpRes) => {
    const filePath = join(workDir, httpReq.url === "/" ? "index.html" : (httpReq.url ?? ""));
    if (existsSync(filePath)) {
      const ext = filePath.split(".").pop() ?? "";
      const mimeTypes: Record<string, string> = {
        html: "text/html",
        js: "application/javascript",
        css: "text/css",
        json: "application/json",
        png: "image/png",
        jpg: "image/jpeg",
      };
      httpRes.writeHead(200, { "Content-Type": mimeTypes[ext] ?? "application/octet-stream" });
      httpRes.end(readFileSync(filePath));
    } else {
      httpRes.writeHead(404);
      httpRes.end("Not found");
    }
  });

  await new Promise<void>((res) => fileServer.listen(0, "127.0.0.1", res));
  const fileServerPort = (fileServer.address() as { port: number }).port;
  const pageUrl = `http://127.0.0.1:${fileServerPort}/`;

  let session;
  let browser;
  try {
    const chromeArgs = buildChromeArgs({ width, height });
    const acquired = await acquireBrowser(chromeArgs);
    browser = acquired.browser;
    console.log(`[render] captureMode=${acquired.captureMode} fps=${fps} ${width}x${height}`);

    session = await createCaptureSession(pageUrl, framesDir, {
      width,
      height,
      fps,
      format: "jpeg",
      quality: quality === "draft" ? 60 : quality === "high" ? 92 : 80,
    });
    await initializeSession(session);

    // Read duration from the page
    const duration: number = await (session as unknown as { page: { evaluate: (fn: () => number) => Promise<number> } })
      .page.evaluate(() => (window as unknown as { __hf: { duration: number } }).__hf.duration);

    const totalFrames = Math.ceil(duration * fps);
    for (let i = 0; i < totalFrames; i++) {
      await captureFrame(session, i, i / fps);
    }
  } finally {
    if (session) await closeCaptureSession(session).catch(() => {});
    if (browser) await releaseBrowser(browser).catch(() => {});
    fileServer.close();
  }

  // Encode frames to video with ffmpeg
  const crf = QUALITY_CRF[quality] ?? 18;
  await execFileAsync("ffmpeg", [
    "-y",
    "-framerate", String(fps),
    "-pattern_type", "glob",
    "-i", join(framesDir, "*.jpg"),
    "-c:v", "libx264",
    "-crf", String(crf),
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    outputPath,
  ]);

  rmSync(workDir, { recursive: true, force: true });
  return outputPath;
}

function parseBody(req: import("node:http").IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      try { resolve(JSON.parse(body)); } catch { reject(new Error("Invalid JSON")); }
    });
    req.on("error", reject);
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost`);

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
    res.setHeader("Content-Type", "video/mp4");
    res.setHeader("Content-Disposition", "attachment; filename=\"render.mp4\"");
    res.removeHeader("Content-Type");
    res.setHeader("Content-Type", "video/mp4");
    const data = readFileSync(entry.path);
    res.writeHead(200);
    res.end(data);
    return;
  }

  if (req.method === "POST" && url.pathname === "/render") {
    const t0 = Date.now();
    let body: unknown;
    try {
      body = await parseBody(req);
    } catch {
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
      res.end(JSON.stringify({
        success: true,
        outputToken: token,
        outputUrl: `/outputs/${token}`,
        fileSize,
        durationMs: Date.now() - t0,
      }));
    } catch (err) {
      res.writeHead(500);
      res.end(JSON.stringify({
        success: false,
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - t0,
      }));
    }
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: "Not found" }));
});

server.listen(PORT, () => {
  console.log(`[hf-renderer] listening on :${PORT}`);
});
