import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, normalize, resolve } from "node:path";

import { loadProjectEnv } from "./lib/env.js";

loadProjectEnv(new URL(".", import.meta.url).pathname);

const { getAnalyzerRuntimeConfig, runAnalysisPipeline } = await import("./lib/analyzers.js");
const DEFAULT_ANALYZER_MODE = getAnalyzerRuntimeConfig().default_mode || "heuristic";

const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 3100);
const PUBLIC_DIR = resolve(new URL("./public", import.meta.url).pathname);
const MAX_BODY_BYTES = 25 * 1024 * 1024;

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp"
};

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8"
  });
  response.end(JSON.stringify(payload, null, 2));
}

function sendNotFound(response) {
  sendJson(response, 404, {
    error: "Not found"
  });
}

function sendMethodNotAllowed(response) {
  sendJson(response, 405, {
    error: "Method not allowed"
  });
}

function parseJsonBody(request) {
  return new Promise((resolveBody, rejectBody) => {
    const chunks = [];
    let totalLength = 0;

    request.on("data", (chunk) => {
      totalLength += chunk.length;
      if (totalLength > MAX_BODY_BYTES) {
        rejectBody(new Error(`Request body too large. Limit is ${MAX_BODY_BYTES} bytes.`));
        request.destroy();
        return;
      }

      chunks.push(chunk);
    });

    request.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8").trim();
      if (!raw) {
        resolveBody({});
        return;
      }

      try {
        resolveBody(JSON.parse(raw));
      } catch {
        rejectBody(new Error("Request body must be valid JSON."));
      }
    });

    request.on("error", (error) => {
      rejectBody(error);
    });
  });
}

function mapAnalyzePayload(payload) {
  const image = payload?.image || {};
  const metadata = payload?.metadata || {};

  return {
    brand: payload?.brand || metadata.brand || null,
    declaredColor: payload?.declared_color || payload?.declaredColor || metadata.declared_color || metadata.declaredColor || null,
    fileSize: image.file_size_bytes ?? null,
    height: image.analyzed_height ?? null,
    imageName: image.name || "uploaded-image",
    listingId: payload?.listing_id || payload?.listingId || metadata.listing_id || metadata.listingId || null,
    mimeType: image.mime_type || "image/unknown",
    model: payload?.model || metadata.model || null,
    mode: payload?.analyzer || DEFAULT_ANALYZER_MODE,
    originalBase64: image.original_base64 || null,
    originalHeight: image.original_height ?? null,
    originalWidth: image.original_width ?? null,
    requestedLabels: payload?.requested_labels || payload?.requestedLabels || null,
    rgbaBase64: image.rgba_base64 || null,
    width: image.analyzed_width ?? null
  };
}

async function handleAnalyze(request, response) {
  if (request.method !== "POST") {
    sendMethodNotAllowed(response);
    return;
  }

  try {
    const payload = mapAnalyzePayload(await parseJsonBody(request));
    const startTime = performance.now();
    const result = await runAnalysisPipeline(payload);
    result.analysis_time_ms = Math.round(performance.now() - startTime);
    sendJson(response, 200, result);
  } catch (error) {
    sendJson(response, 400, {
      error: error instanceof Error ? error.message : "分析失败。"
    });
  }
}

function sanitizePublicPath(urlPathname) {
  const safePath = normalize(decodeURIComponent(urlPathname)).replace(/^(\.\.[/\\])+/, "");
  const candidatePath = resolve(PUBLIC_DIR, `.${safePath}`);
  return candidatePath.startsWith(PUBLIC_DIR) ? candidatePath : null;
}

async function serveStatic(response, url) {
  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = sanitizePublicPath(pathname);

  if (!filePath || !existsSync(filePath) || !statSync(filePath).isFile()) {
    sendNotFound(response);
    return;
  }

  const extension = extname(filePath).toLowerCase();
  response.writeHead(200, {
    "Content-Type": MIME_TYPES[extension] || "application/octet-stream"
  });
  createReadStream(filePath).pipe(response);
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);

  if (url.pathname === "/health") {
    sendJson(response, 200, {
      analyzer: getAnalyzerRuntimeConfig(),
      service: "carhome",
      status: "ok"
    });
    return;
  }

  if (url.pathname === "/api/config" || url.pathname === "/api/runtime-config") {
    sendJson(response, 200, {
      analyzer: getAnalyzerRuntimeConfig()
    });
    return;
  }

  if (url.pathname === "/api/analyze") {
    await handleAnalyze(request, response);
    return;
  }

  await serveStatic(response, url);
});

server.listen(PORT, HOST, () => {
  console.log(`carhome listening on http://${HOST}:${PORT}`);
});

export { server };
