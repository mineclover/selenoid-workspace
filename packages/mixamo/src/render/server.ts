import { createServer, type Server } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { extname } from "node:path";
import { buildViewerHtml } from "./viewer.js";

const MIME: Record<string, string> = {
  html: "text/html",
  js:   "application/javascript",
  fbx:  "application/octet-stream",
  png:  "image/png",
  jpg:  "image/jpeg",
  jpeg: "image/jpeg",
  bmp:  "image/bmp",
  tga:  "image/x-tga",
};

export interface ViewerUrlOptions {
  charPath?: string;  // character FBX (mesh + skeleton)
  animPath?: string;  // animation FBX (retarget onto char)
  view?: string;
  bg?: string;
}

export interface RenderServer {
  port: number;
  viewerUrl: (fallbackFbxPath: string, opts?: ViewerUrlOptions) => string;
  close: () => void;
}

export function startRenderServer(opts: {
  bgColor?: string;
  view?: "side" | "front" | "back";
  frustumHeight?: number;
}): Promise<RenderServer> {
  const viewerHtml = buildViewerHtml(opts);

  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");

    if (url.pathname === "/" || url.pathname === "/viewer") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(viewerHtml);
      return;
    }

    if (url.pathname === "/file") {
      const filePath = url.searchParams.get("path");
      if (!filePath || !existsSync(filePath)) {
        res.writeHead(404); res.end("Not found"); return;
      }
      const ext = extname(filePath).slice(1).toLowerCase();
      res.writeHead(200, {
        "Content-Type": MIME[ext] ?? "application/octet-stream",
        "Access-Control-Allow-Origin": "*",
      });
      res.end(readFileSync(filePath));
      return;
    }

    res.writeHead(404); res.end();
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as { port: number }).port;
      const fileUrl = (p: string) =>
        `http://127.0.0.1:${port}/file?path=${encodeURIComponent(p)}`;

      resolve({
        port,
        viewerUrl(fallbackFbx, viewOpts = {}) {
          const params = new URLSearchParams();
          if (viewOpts.charPath) params.set("char", fileUrl(viewOpts.charPath));
          else                   params.set("fbx",  fileUrl(fallbackFbx));
          if (viewOpts.animPath) params.set("anim", fileUrl(viewOpts.animPath));
          if (viewOpts.view)     params.set("view", viewOpts.view);
          if (viewOpts.bg)       params.set("bg",   viewOpts.bg);
          return `http://127.0.0.1:${port}/viewer?${params}`;
        },
        close() { server.close(); },
      });
    });
  });
}
