import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { promisify } from "node:util";

import { loadProjectEnv } from "../lib/env.js";

loadProjectEnv(resolve(new URL("..", import.meta.url).pathname));

const { runAnalysisPipeline } = await import("../lib/analyzers.js");
const execFileAsync = promisify(execFile);

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const DEFAULT_MODE = process.env.BATCH_EVAL_MODE || "heuristic";
const REPORT_DIR = resolve(new URL("../tmp/reports", import.meta.url).pathname);
const PREP_DIR = resolve(new URL("../tmp/batch-prep", import.meta.url).pathname);

const SUPPORTED_EXPECTATION_MAP = [
  { keywords: ["过曝"], label: "过曝" },
  { keywords: ["偏暗"], label: "偏暗" },
  { keywords: ["虚图", "模糊"], label: "虚图 / 模糊" },
  { keywords: ["构图"], label: "构图异常" },
  { keywords: ["杂乱"], label: "背景杂乱" }
];

const UNSUPPORTED_HINTS = [
  "污渍",
  "划痕",
  "掉漆",
  "生锈",
  "镜头脏",
  "非原厂",
  "涂装",
  "拉花",
  "阴影",
  "闪光"
];

function parseArgs(argv) {
  const args = argv.slice(2);
  const options = {
    directory: null,
    mode: DEFAULT_MODE
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--mode") {
      options.mode = args[index + 1] || DEFAULT_MODE;
      index += 1;
      continue;
    }

    if (!options.directory) {
      options.directory = arg;
    }
  }

  if (!options.directory) {
    throw new Error("Usage: node scripts/batch-eval.js <directory> [--mode heuristic|gemini|hybrid]");
  }

  return options;
}

function detectMimeType(filePath) {
  const extension = extname(filePath).toLowerCase();
  if (extension === ".jpg" || extension === ".jpeg") {
    return "image/jpeg";
  }

  if (extension === ".png") {
    return "image/png";
  }

  if (extension === ".webp") {
    return "image/webp";
  }

  return "application/octet-stream";
}

function detectExpectedLabels(fileName) {
  return SUPPORTED_EXPECTATION_MAP
    .filter((item) => item.keywords.some((keyword) => fileName.includes(keyword)))
    .map((item) => item.label);
}

function detectUnsupportedHints(fileName) {
  return UNSUPPORTED_HINTS.filter((keyword) => fileName.includes(keyword));
}

function sanitizeStem(fileName) {
  return fileName.replace(/[^A-Za-z0-9._-]+/gu, "_");
}

function parseBmpDimensions(buffer) {
  if (buffer.toString("ascii", 0, 2) !== "BM") {
    throw new Error("Unsupported BMP header.");
  }

  return {
    bitsPerPixel: buffer.readUInt16LE(28),
    height: Math.abs(buffer.readInt32LE(22)),
    pixelOffset: buffer.readUInt32LE(10),
    rawHeight: buffer.readInt32LE(22),
    width: buffer.readInt32LE(18)
  };
}

function decodeBmpToRgba(buffer) {
  const { bitsPerPixel, height, pixelOffset, rawHeight, width } = parseBmpDimensions(buffer);
  if (![24, 32].includes(bitsPerPixel)) {
    throw new Error(`Unsupported BMP bit depth: ${bitsPerPixel}`);
  }

  const bytesPerPixel = bitsPerPixel / 8;
  const topDown = rawHeight < 0;
  const rowStride = Math.floor((bitsPerPixel * width + 31) / 32) * 4;
  const rgba = Buffer.alloc(width * height * 4);

  for (let y = 0; y < height; y += 1) {
    const bmpY = topDown ? y : height - 1 - y;
    const rowStart = pixelOffset + bmpY * rowStride;

    for (let x = 0; x < width; x += 1) {
      const bmpOffset = rowStart + x * bytesPerPixel;
      const rgbaOffset = (y * width + x) * 4;
      rgba[rgbaOffset] = buffer[bmpOffset + 2];
      rgba[rgbaOffset + 1] = buffer[bmpOffset + 1];
      rgba[rgbaOffset + 2] = buffer[bmpOffset];
      rgba[rgbaOffset + 3] = bytesPerPixel === 4 ? buffer[bmpOffset + 3] : 255;
    }
  }

  return {
    height,
    rgbaBase64: rgba.toString("base64"),
    width
  };
}

async function getImageDimensions(filePath) {
  const { stdout } = await execFileAsync("sips", ["-g", "pixelWidth", "-g", "pixelHeight", filePath]);
  const widthMatch = stdout.match(/pixelWidth:\s*(\d+)/u);
  const heightMatch = stdout.match(/pixelHeight:\s*(\d+)/u);

  return {
    originalHeight: heightMatch ? Number(heightMatch[1]) : null,
    originalWidth: widthMatch ? Number(widthMatch[1]) : null
  };
}

async function buildHybridPayload(filePath, fileName, originalBuffer) {
  await mkdir(PREP_DIR, { recursive: true });

  const bmpPath = join(PREP_DIR, `${sanitizeStem(fileName)}.bmp`);
  await execFileAsync("sips", ["-s", "format", "bmp", "-Z", "512", filePath, "--out", bmpPath]);

  const bmpBuffer = await readFile(bmpPath);
  const { width, height, rgbaBase64 } = decodeBmpToRgba(bmpBuffer);
  const { originalWidth, originalHeight } = await getImageDimensions(filePath);

  return {
    fileSize: originalBuffer.byteLength,
    height,
    imageName: fileName,
    mimeType: detectMimeType(filePath),
    originalBase64: originalBuffer.toString("base64"),
    originalHeight,
    originalWidth,
    rgbaBase64,
    width
  };
}

async function listImageFiles(directory) {
  const dir = await import("node:fs/promises").then((module) => module.readdir(directory, { withFileTypes: true }));

  return dir
    .filter((entry) => entry.isFile() && IMAGE_EXTENSIONS.has(extname(entry.name).toLowerCase()))
    .map((entry) => join(directory, entry.name))
    .sort((left, right) => basename(left, extname(left)).localeCompare(basename(right, extname(right)), "zh-Hans-CN"));
}

function toCsvValue(value) {
  const text = Array.isArray(value) ? value.join("|") : value == null ? "" : String(value);
  return `"${text.replace(/"/gu, '""')}"`;
}

function toCsv(rows) {
  const headers = [
    "file_name",
    "mode_requested",
    "mode_effective",
    "scene_type",
    "scene_type_cn",
    "scene_scope",
    "scene_area",
    "scene_confidence",
    "view_angle",
    "view_angle_cn",
    "view_angle_confidence",
    "focus_part",
    "focus_part_cn",
    "focus_part_confidence",
    "decision",
    "review_recommendation",
    "issue_types",
    "expected_mvp_labels",
    "unsupported_hints",
    "all_expected_hit",
    "error_message",
    "fallback_used",
    "severity",
    "provider",
    "analysis_time_ms",
    "summary",
    "out_of_scope_note"
  ];

  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((header) => toCsvValue(row[header])).join(","));
  }
  return lines.join("\n");
}

function buildAggregate(rows) {
  const successfulRows = rows.filter((row) => !row.error_message);
  const inScope = successfulRows.filter((row) => row.expected_mvp_labels.length > 0);
  const outOfScope = rows.filter((row) => row.expected_mvp_labels.length === 0);
  const hitAllExpected = inScope.filter((row) => row.all_expected_hit).length;
  const fallbackCount = rows.filter((row) => row.fallback_used).length;

  return {
    error_count: rows.filter((row) => row.error_message).length,
    fallback_count: fallbackCount,
    file_count: rows.length,
    in_scope_count: inScope.length,
    in_scope_hit_rate: inScope.length ? Number((hitAllExpected / inScope.length).toFixed(3)) : null,
    out_of_scope_count: outOfScope.length
  };
}

async function main() {
  const { directory, mode } = parseArgs(process.argv);
  const resolvedDirectory = resolve(directory);

  if (!existsSync(resolvedDirectory)) {
    throw new Error(`Directory not found: ${resolvedDirectory}`);
  }

  if (!["heuristic", "gemini", "hybrid"].includes(mode)) {
    throw new Error(`Batch eval currently supports only heuristic, gemini, or hybrid mode. Received: ${mode}`);
  }

  const files = await listImageFiles(resolvedDirectory);
  if (!files.length) {
    throw new Error(`No image files found in: ${resolvedDirectory}`);
  }

  await mkdir(REPORT_DIR, { recursive: true });

  const rows = [];
  const timestamp = new Date().toISOString().replace(/[:.]/gu, "-");
  const jsonPath = join(REPORT_DIR, `batch-eval-${timestamp}.json`);
  const csvPath = join(REPORT_DIR, `batch-eval-${timestamp}.csv`);

  async function writeReports() {
    const payload = {
      aggregate: buildAggregate(rows),
      directory: resolvedDirectory,
      mode,
      rows
    };

    await writeFile(jsonPath, `${JSON.stringify(payload, null, 2)}\n`);
    await writeFile(csvPath, `${toCsv(rows)}\n`);
  }

  for (const filePath of files) {
    const fileName = basename(filePath);
    const buffer = await readFile(filePath);
    const expectedLabels = detectExpectedLabels(fileName);
    const unsupportedHints = detectUnsupportedHints(fileName);
    const startedAt = Date.now();

    console.log(`evaluating | mode=${mode} | file=${fileName}`);

    try {
      const payload =
        mode === "gemini"
          ? {
              fileSize: buffer.byteLength,
              imageName: fileName,
              mimeType: detectMimeType(filePath),
              originalBase64: buffer.toString("base64")
            }
          : await buildHybridPayload(filePath, fileName, buffer);

      const result = await runAnalysisPipeline({
        ...payload,
        mode
      });

      const issueTypes = Array.isArray(result.issue_types) ? result.issue_types : [];
      rows.push({
        all_expected_hit: expectedLabels.length > 0 ? expectedLabels.every((label) => issueTypes.includes(label)) : null,
        analysis_time_ms: Date.now() - startedAt,
        decision: result.decision,
        error_message: null,
        expected_mvp_labels: expectedLabels,
        fallback_used: Boolean(result.runtime?.fallback_used),
        file_name: fileName,
        issue_types: issueTypes,
        mode_effective: result.runtime?.effective_mode || mode,
        mode_requested: result.runtime?.requested_mode || mode,
        provider: result.provider?.name || null,
        focus_part: result.focus_part?.label || result.scene?.focus_part?.label || null,
        focus_part_cn: result.focus_part?.label_cn || result.scene?.focus_part?.label_cn || null,
        focus_part_confidence: result.focus_part?.confidence ?? result.scene?.focus_part?.confidence ?? null,
        scene_area: result.scene?.area || null,
        scene_confidence: result.scene?.confidence ?? null,
        scene_scope: result.scene?.scope || null,
        scene_type: result.scene?.label || null,
        scene_type_cn: result.scene?.label_cn || null,
        view_angle: result.view_angle?.label || result.scene?.view_angle?.label || null,
        view_angle_cn: result.view_angle?.label_cn || result.scene?.view_angle?.label_cn || null,
        view_angle_confidence: result.view_angle?.confidence ?? result.scene?.view_angle?.confidence ?? null,
        review_recommendation: result.review_recommendation,
        severity: result.severity,
        summary: result.gemini?.overall_summary || result.reasons?.join("；") || "",
        out_of_scope_note: result.out_of_scope_note || null,
        unsupported_hints: unsupportedHints
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      rows.push({
        all_expected_hit: null,
        analysis_time_ms: Date.now() - startedAt,
        decision: "error",
        error_message: message,
        expected_mvp_labels: expectedLabels,
        fallback_used: false,
        file_name: fileName,
        issue_types: [],
        mode_effective: mode,
        mode_requested: mode,
        provider: null,
        focus_part: null,
        focus_part_cn: null,
        focus_part_confidence: null,
        scene_area: null,
        scene_confidence: null,
        scene_scope: null,
        scene_type: null,
        scene_type_cn: null,
        view_angle: null,
        view_angle_cn: null,
        view_angle_confidence: null,
        review_recommendation: null,
        severity: null,
        summary: "",
        out_of_scope_note: null,
        unsupported_hints: unsupportedHints
      });
      console.error(`error | file=${fileName} | message=${message}`);
    }

    await writeReports();
  }

  const payload = {
    aggregate: buildAggregate(rows),
    directory: resolvedDirectory,
    mode,
    rows
  };

  console.log(JSON.stringify({ csv_report: csvPath, json_report: jsonPath, ...payload.aggregate }, null, 2));
}

await main();
