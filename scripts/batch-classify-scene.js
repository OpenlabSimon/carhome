import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";

import { loadProjectEnv } from "../lib/env.js";
import { GeminiVisionProvider } from "../lib/gemini-vision-provider.js";

loadProjectEnv(resolve(new URL("..", import.meta.url).pathname));

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const DEFAULT_CONCURRENCY = 4;

const SCENE_LABEL_COPY = {
  full_exterior: "整车外观",
  partial_exterior: "局部外观",
  partial_interior: "局部内饰",
  vehicle_accessory: "车辆附件"
};

const VIEW_ANGLE_COPY = {
  detail: "局部特写",
  front: "车头正拍",
  front_45: "前45度",
  interior_center: "中控视角",
  interior_driver: "驾驶位视角",
  interior_rear: "后排视角",
  rear: "车尾正拍",
  rear_45: "后45度",
  side: "侧面",
  unknown: "未知角度"
};

const FOCUS_PART_COPY = {
  air_vent: "出风口",
  badge: "车标/铭牌",
  center_console: "中控台",
  charging_port: "充电/数据接口",
  control_panel: "控制面板",
  cup_holder: "杯架",
  dashboard: "仪表台",
  door_exterior: "车门外观",
  door_interior: "车门内饰",
  engine_bay: "发动机舱",
  front_face: "前脸",
  fuel_cap: "油箱盖/加油口",
  full_vehicle: "整车",
  grille: "中网/格栅",
  headlight: "大灯",
  key_fob: "车钥匙",
  mirror: "后视镜",
  pedal: "踏板区",
  pillar_trim: "立柱/顶棚边缘",
  rear_face: "车尾",
  rear_space: "后排空间",
  roof: "车顶/顶棚",
  screen: "屏幕",
  seat: "座椅",
  steering_wheel: "方向盘",
  taillight: "尾灯",
  trunk: "后备箱",
  unknown: "未知部位",
  vin_plate: "铭牌/VIN",
  wheel: "轮毂/轮胎",
  window: "车窗/玻璃"
};

function parseArgs(argv) {
  const args = argv.slice(2);
  const options = {
    concurrency: DEFAULT_CONCURRENCY,
    directory: null,
    outputPrefix: null
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--concurrency") {
      options.concurrency = Number(args[index + 1] || DEFAULT_CONCURRENCY);
      index += 1;
      continue;
    }

    if (arg === "--output-prefix") {
      options.outputPrefix = args[index + 1] || null;
      index += 1;
      continue;
    }

    if (!options.directory) {
      options.directory = arg;
    }
  }

  if (!options.directory) {
    throw new Error(
      "Usage: node scripts/batch-classify-scene.js <directory> [--concurrency 4] [--output-prefix /path/prefix]"
    );
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

async function listImageFiles(directory) {
  const dir = await readdir(directory, { withFileTypes: true });

  return dir
    .filter((entry) => entry.isFile() && IMAGE_EXTENSIONS.has(extname(entry.name).toLowerCase()))
    .map((entry) => join(directory, entry.name))
    .sort((left, right) => basename(left).localeCompare(basename(right), "zh-Hans-CN"));
}

function toCsvValue(value) {
  const text = Array.isArray(value) ? value.join("|") : value == null ? "" : String(value);
  return `"${text.replace(/"/gu, '""')}"`;
}

function toCsv(rows) {
  const headers = [
    "file_name",
    "scene_type",
    "scene_type_cn",
    "scene_confidence",
    "view_angle",
    "view_angle_cn",
    "view_angle_confidence",
    "focus_part",
    "focus_part_cn",
    "focus_part_confidence",
    "recognition_status",
    "unknown_fields",
    "provider",
    "model",
    "protocol",
    "analysis_time_ms",
    "error_message"
  ];

  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((header) => toCsvValue(row[header])).join(","));
  }
  return lines.join("\n");
}

function isUnknownLabel(value) {
  const label = String(value || "").trim();
  return !label || label === "unknown";
}

function buildRecognitionStatus(scene) {
  const unknownFields = [];

  if (isUnknownLabel(scene?.label)) {
    unknownFields.push("scene");
  }

  if (isUnknownLabel(scene?.view_angle?.label)) {
    unknownFields.push("view_angle");
  }

  if (isUnknownLabel(scene?.focus_part?.label)) {
    unknownFields.push("focus_part");
  }

  if (unknownFields.length === 3) {
    return {
      recognition_status: "unrecognized",
      unknown_fields: unknownFields
    };
  }

  if (unknownFields.length > 0) {
    return {
      recognition_status: "partial",
      unknown_fields: unknownFields
    };
  }

  return {
    recognition_status: "identified",
    unknown_fields: []
  };
}

async function runWorker(workerIndex, files, state) {
  const provider = new GeminiVisionProvider();

  while (true) {
    const filePath = files[state.nextIndex];
    state.nextIndex += 1;

    if (!filePath) {
      return;
    }

    const fileName = basename(filePath);
    const startedAt = Date.now();
    console.log(`classifying | worker=${workerIndex} | file=${fileName}`);

    try {
      const buffer = await readFile(filePath);
      const scene = await provider.classifyScene({
        imageBase64: buffer.toString("base64"),
        metadata: {},
        mimeType: detectMimeType(filePath)
      });
      const recognition = buildRecognitionStatus(scene);

      state.rows.push({
        analysis_time_ms: Date.now() - startedAt,
        error_message: null,
        file_name: fileName,
        focus_part: scene.focus_part?.label || null,
        focus_part_cn: scene.focus_part?.label ? FOCUS_PART_COPY[scene.focus_part.label] || scene.focus_part.label : null,
        focus_part_confidence: scene.focus_part?.confidence ?? null,
        model: scene.model || null,
        protocol: scene.protocol || null,
        provider: scene.provider || null,
        recognition_status: recognition.recognition_status,
        scene_confidence: scene.confidence ?? null,
        scene_type: scene.label || null,
        scene_type_cn: scene.label ? SCENE_LABEL_COPY[scene.label] || scene.label : null,
        unknown_fields: recognition.unknown_fields,
        view_angle: scene.view_angle?.label || null,
        view_angle_cn: scene.view_angle?.label ? VIEW_ANGLE_COPY[scene.view_angle.label] || scene.view_angle.label : null,
        view_angle_confidence: scene.view_angle?.confidence ?? null
      });
    } catch (error) {
      state.rows.push({
        analysis_time_ms: Date.now() - startedAt,
        error_message: error instanceof Error ? error.message : "Unknown error",
        file_name: fileName,
        focus_part: null,
        focus_part_cn: null,
        focus_part_confidence: null,
        model: null,
        protocol: null,
        provider: null,
        recognition_status: "unrecognized",
        scene_confidence: null,
        scene_type: null,
        scene_type_cn: null,
        unknown_fields: ["scene", "view_angle", "focus_part"],
        view_angle: null,
        view_angle_cn: null,
        view_angle_confidence: null
      });
    }
  }
}

async function main() {
  const { directory, concurrency, outputPrefix } = parseArgs(process.argv);
  const resolvedDirectory = resolve(directory);

  if (!existsSync(resolvedDirectory)) {
    throw new Error(`Directory not found: ${resolvedDirectory}`);
  }

  const files = await listImageFiles(resolvedDirectory);
  if (!files.length) {
    throw new Error(`No image files found in: ${resolvedDirectory}`);
  }

  const effectiveConcurrency = Number.isFinite(concurrency) && concurrency > 0 ? Math.floor(concurrency) : DEFAULT_CONCURRENCY;
  const state = {
    nextIndex: 0,
    rows: []
  };

  await Promise.all(
    Array.from({ length: Math.min(effectiveConcurrency, files.length) }, (_, index) =>
      runWorker(index + 1, files, state)
    )
  );

  const rows = [...state.rows].sort((left, right) => left.file_name.localeCompare(right.file_name, "zh-Hans-CN"));
  const partialRows = rows.filter((row) => row.recognition_status !== "identified");
  const prefix =
    outputPrefix ||
    resolve(new URL(`../tmp/reports/scene-classify-${new Date().toISOString().replace(/[:.]/gu, "-")}`, import.meta.url).pathname);

  await mkdir(dirname(prefix), { recursive: true });

  const payload = {
    aggregate: {
      identified_count: rows.filter((row) => row.recognition_status === "identified").length,
      partial_count: rows.filter((row) => row.recognition_status === "partial").length,
      total_count: rows.length,
      unrecognized_count: rows.filter((row) => row.recognition_status === "unrecognized").length
    },
    directory: resolvedDirectory,
    rows
  };

  const allJsonPath = `${prefix}.json`;
  const allCsvPath = `${prefix}.csv`;
  const partialJsonPath = `${prefix}-未完全识别.json`;
  const partialCsvPath = `${prefix}-未完全识别.csv`;

  await writeFile(allJsonPath, `${JSON.stringify(payload, null, 2)}\n`);
  await writeFile(allCsvPath, `${toCsv(rows)}\n`);
  await writeFile(partialJsonPath, `${JSON.stringify({ file_count: partialRows.length, rows: partialRows }, null, 2)}\n`);
  await writeFile(partialCsvPath, `${toCsv(partialRows)}\n`);

  console.log(
    JSON.stringify(
      {
        all_csv: allCsvPath,
        all_json: allJsonPath,
        ...payload.aggregate,
        partial_csv: partialCsvPath,
        partial_json: partialJsonPath
      },
      null,
      2
    )
  );
}

await main();
