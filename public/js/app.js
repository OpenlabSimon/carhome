const fileInput = document.querySelector("#image-input");
const dropzone = document.querySelector("#dropzone");
const statusPill = document.querySelector("#status-pill");
const reanalyzeButton = document.querySelector("#reanalyze-button");
const analyzerSelect = document.querySelector("#analyzer-select");
const modeCopy = document.querySelector("#mode-copy");
const capabilityCopy = document.querySelector("#capability-copy");
const previewImage = document.querySelector("#preview-image");
const previewPlaceholder = document.querySelector("#preview-placeholder");
const imageMeta = document.querySelector("#image-meta");
const summaryCard = document.querySelector("#summary-card");
const tagStrip = document.querySelector("#tag-strip");
const reasonList = document.querySelector("#reason-list");
const metricsGrid = document.querySelector("#metrics-grid");
const detailGrid = document.querySelector("#detail-grid");
const jsonOutput = document.querySelector("#json-output");

const analysisCanvas = document.createElement("canvas");
const analysisContext = analysisCanvas.getContext("2d", { willReadFrequently: true });

let currentFile = null;
let currentObjectUrl = null;

const MODE_DEFINITIONS = {
  heuristic: "仅跑本地启发式 baseline，无需 Gemini key。",
  gemini: "直接调用 Gemini VLM 做 5 类标签判断，需要配置 GEMINI_API_KEY；失败时会回退。",
  hybrid: "先产出启发式基础信号，再交给 Gemini 对 5 类标签做最终判断和解释。"
};

const METRIC_DEFINITIONS = [
  ["brightness_mean", "平均亮度", "整体亮度基线值，过高易过曝，过低易偏暗。"],
  ["bright_ratio", "亮部占比", "接近纯白的像素比例，用于识别发白和细节丢失。"],
  ["dark_ratio", "暗部占比", "接近纯黑的像素比例，用于识别偏暗问题。"],
  ["sharpness_index", "清晰度指数", "由拉普拉斯方差和亮度波动综合得出，越低越可能模糊。"],
  ["border_edge_density", "边框复杂度", "外圈边缘密度越高，背景越可能杂乱。"],
  ["edge_center_offset", "重心偏移", "主体边缘重心离画面中心越远，构图越可能失衡。"]
];

function setStatus(text, type = "neutral") {
  statusPill.textContent = text;
  statusPill.className = "status-pill";

  if (type !== "neutral") {
    statusPill.classList.add(`status-${type}`);
  }
}

function updateModeCopy() {
  modeCopy.textContent = MODE_DEFINITIONS[analyzerSelect.value] || MODE_DEFINITIONS.heuristic;
}

function resetResultPanels() {
  tagStrip.innerHTML = "";
  reasonList.innerHTML = "";
  metricsGrid.innerHTML = "";
  detailGrid.innerHTML = "";
}

function formatBytes(bytes) {
  if (!bytes && bytes !== 0) {
    return "未知大小";
  }

  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatMetricValue(key, value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "N/A";
  }

  if (
    key.endsWith("_ratio") ||
    key === "edge_center_offset" ||
    key === "edge_density" ||
    key === "border_edge_density" ||
    key === "center_edge_density"
  ) {
    return `${(Number(value) * 100).toFixed(1)}%`;
  }

  return Number(value).toFixed(Number(value) > 100 ? 1 : 2);
}

function fitSize(width, height, maxDimension = 512) {
  const scale = Math.min(1, maxDimension / Math.max(width, height));

  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale))
  };
}

function loadImage(objectUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("图片加载失败，请尝试其他文件。"));
    image.src = objectUrl;
  });
}

function bytesToBase64(bytes) {
  const chunkSize = 0x8000;
  let binary = "";

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return window.btoa(binary);
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === "string" ? reader.result : "";
      const [, base64 = ""] = dataUrl.split(",", 2);
      resolve(base64);
    };
    reader.onerror = () => reject(new Error("原图读取失败。"));
    reader.readAsDataURL(file);
  });
}

async function loadAnalyzerConfig() {
  try {
    const response = await fetch("/api/config");
    if (!response.ok) {
      throw new Error("Config request failed.");
    }

    const config = await response.json();
    const defaultMode = config?.analyzer?.default_mode || "heuristic";
    if ([...analyzerSelect.options].some((option) => option.value === defaultMode)) {
      analyzerSelect.value = defaultMode;
      updateModeCopy();
    }
    const gemini = config?.analyzer?.gemini || {};
    capabilityCopy.textContent = gemini.configured
      ? `Gemini 已配置，provider：${gemini.providerName || "unknown"}，默认模型：${gemini.model || "unknown"}；默认分析模式：${defaultMode}。`
      : `Gemini 未配置，gemini / hybrid 会自动回退到 heuristic；默认分析模式：${defaultMode}。`;
  } catch {
    capabilityCopy.textContent = "未能读取服务端能力信息，默认按本地启发式可用处理。";
  }
}

function renderSummary(result) {
  const decision = result.decision || (result.has_issue ? "risk" : result.out_of_scope_note ? "out_of_scope" : "pass");
  const clean = decision === "pass";
  const providerName = result.provider?.name || result.runtime?.provider?.name || "unknown";
  const fallbackCopy = result.runtime?.fallback_used ? " · fallback" : "";
  const title =
    decision === "out_of_scope"
      ? "发现超纲问题"
      : clean
        ? "未发现明显问题"
        : "检测到质量问题";
  const summaryCopy =
    decision === "out_of_scope"
      ? "当前图片未命中 5 类 MVP 标签，但检测到超出当前范围的问题，建议人工复核。"
      : clean
        ? "当前图片未命中 5 类 MVP 问题，可作为人工复核前的初筛通过样本。"
        : `命中 ${result.issue_types.length} 个标签：${result.issue_types.join("、")}。`;
  summaryCard.className = `summary-card ${clean ? "clean" : "issue"}`;
  summaryCard.innerHTML = `
    <div class="summary-title">${escapeHtml(title)} · ${escapeHtml(decision)}</div>
    <div class="summary-copy">${escapeHtml(summaryCopy)}</div>
    <div class="summary-meta">
      <span>模式 ${escapeHtml(result.runtime?.effective_mode || result.analyzer?.mode || "unknown")}${escapeHtml(fallbackCopy)}</span>
      <span>provider ${escapeHtml(providerName)}</span>
      <span>置信度 ${Math.round((Number(result.confidence) || 0) * 100)}%</span>
      <span>严重程度 ${escapeHtml(result.severity || "unknown")}</span>
      <span>分析耗时 ${escapeHtml(result.analysis_time_ms || 0)} ms</span>
    </div>
  `;
}

function renderTags(result) {
  tagStrip.innerHTML = "";

  if (result.scene?.label_cn) {
    const sceneBadge = document.createElement("span");
    sceneBadge.className = "badge badge-accent";
    sceneBadge.textContent = `场景 ${result.scene.label_cn}`;
    tagStrip.appendChild(sceneBadge);
  }

  if (result.view_angle?.label_cn) {
    const angleBadge = document.createElement("span");
    angleBadge.className = "badge badge-accent";
    angleBadge.textContent = `角度 ${result.view_angle.label_cn}`;
    tagStrip.appendChild(angleBadge);
  }

  if (result.focus_part?.label_cn) {
    const partBadge = document.createElement("span");
    partBadge.className = "badge badge-accent";
    partBadge.textContent = `部位 ${result.focus_part.label_cn}`;
    tagStrip.appendChild(partBadge);
  }

  if (!result.issue_types?.length) {
    if (result.decision === "out_of_scope") {
      const outOfScopeBadge = document.createElement("span");
      outOfScopeBadge.className = "badge badge-hit";
      outOfScopeBadge.textContent = "超纲问题";
      tagStrip.appendChild(outOfScopeBadge);
      return;
    }

    const passBadge = document.createElement("span");
    passBadge.className = "badge badge-ok";
    passBadge.textContent = "通过初筛";
    tagStrip.appendChild(passBadge);
    return;
  }

  for (const issueType of result.issue_types) {
    const badge = document.createElement("span");
    badge.className = "badge badge-hit";
    badge.textContent = issueType;
    tagStrip.appendChild(badge);
  }
}

function renderReasons(result) {
  reasonList.innerHTML = "";

  if (result.scene?.label_cn) {
    const item = document.createElement("div");
    item.className = "reason-item";
    item.textContent = `场景分类：${result.scene.label_cn}（${Math.round((Number(result.scene.confidence) || 0) * 100)}%）${
      result.scene.reason ? `；${result.scene.reason}` : ""
    }`;
    reasonList.appendChild(item);
  }

  if (result.view_angle?.label_cn) {
    const item = document.createElement("div");
    item.className = "reason-item";
    item.textContent = `拍摄角度：${result.view_angle.label_cn}（${Math.round((Number(result.view_angle.confidence) || 0) * 100)}%）${
      result.view_angle.reason ? `；${result.view_angle.reason}` : ""
    }`;
    reasonList.appendChild(item);
  }

  if (result.focus_part?.label_cn) {
    const item = document.createElement("div");
    item.className = "reason-item";
    item.textContent = `特写部位：${result.focus_part.label_cn}（${Math.round((Number(result.focus_part.confidence) || 0) * 100)}%）${
      result.focus_part.reason ? `；${result.focus_part.reason}` : ""
    }`;
    reasonList.appendChild(item);
  }

  if (!result.reasons?.length) {
    const item = document.createElement("div");
    item.className = "reason-item";
    item.textContent = "未命中当前 5 类 MVP 标签。";
    reasonList.appendChild(item);
  } else {
    for (const reason of result.reasons) {
      const item = document.createElement("div");
      item.className = "reason-item";
      item.textContent = reason;
      reasonList.appendChild(item);
    }
  }

  if (result.gemini?.overall_summary) {
    const item = document.createElement("div");
    item.className = "reason-item";
    item.textContent = `Gemini 总结：${result.gemini.overall_summary}`;
    reasonList.appendChild(item);
  }

  if (result.out_of_scope_note) {
    const item = document.createElement("div");
    item.className = "reason-item";
    item.textContent = `超纲备注：${result.out_of_scope_note}`;
    reasonList.appendChild(item);
  }

  if (result.runtime?.fallback_reason) {
    const item = document.createElement("div");
    item.className = "reason-item";
    item.textContent = `Fallback：${result.runtime.fallback_reason}`;
    reasonList.appendChild(item);
  }
}

function renderMetrics(result) {
  metricsGrid.innerHTML = "";

  if (!result.metrics) {
    const item = document.createElement("div");
    item.className = "reason-item";
    item.textContent = "当前模式未返回启发式指标。";
    metricsGrid.appendChild(item);
    return;
  }

  for (const [key, label, copy] of METRIC_DEFINITIONS) {
    const card = document.createElement("div");
    card.className = "metric-card";
    card.innerHTML = `
      <div class="metric-label">${label}</div>
      <div class="metric-value">${formatMetricValue(key, result.metrics[key])}</div>
      <div class="metric-copy">${copy}</div>
    `;
    metricsGrid.appendChild(card);
  }
}

function renderDetails(result) {
  detailGrid.innerHTML = "";

  for (const detail of result.details || []) {
    const card = document.createElement("div");
    card.className = `detail-card ${detail.hit ? "is-hit" : ""}`;
    const baselineCopy = detail.baseline
      ? `<div class="detail-baseline">baseline: ${detail.baseline.hit ? "hit" : "miss"} / score ${escapeHtml(
          detail.baseline.score
        )}</div>`
      : "";

    card.innerHTML = `
      <div class="detail-header">
        <div class="detail-title">${escapeHtml(detail.issue_type)}</div>
        <div class="detail-score">${escapeHtml(detail.source || "unknown")} · score ${escapeHtml(
          detail.score
        )} / threshold ${escapeHtml(detail.threshold)}</div>
      </div>
      <div class="detail-copy">${escapeHtml(detail.reason)}</div>
      ${baselineCopy}
      <div class="detail-bar"><span style="width: ${Math.min(100, Number(detail.score || 0) * 100)}%"></span></div>
    `;
    detailGrid.appendChild(card);
  }
}

function renderJson(result) {
  jsonOutput.textContent = JSON.stringify(result, null, 2);
}

async function buildAnalyzePayload(file, mode) {
  if (!analysisContext) {
    throw new Error("当前浏览器不支持 Canvas 图像分析。");
  }

  const objectUrl = URL.createObjectURL(file);

  try {
    const image = await loadImage(objectUrl);
    const fitted = fitSize(image.naturalWidth, image.naturalHeight, 512);
    analysisCanvas.width = fitted.width;
    analysisCanvas.height = fitted.height;
    analysisContext.clearRect(0, 0, fitted.width, fitted.height);
    analysisContext.drawImage(image, 0, 0, fitted.width, fitted.height);
    const imageData = analysisContext.getImageData(0, 0, fitted.width, fitted.height);

    const payload = {
      analyzer: mode,
      image: {
        analyzed_height: fitted.height,
        analyzed_width: fitted.width,
        rgba_base64: bytesToBase64(imageData.data),
        name: file.name,
        mime_type: file.type || "image/unknown",
        file_size_bytes: file.size,
        original_width: image.naturalWidth,
        original_height: image.naturalHeight
      }
    };

    if (mode !== "heuristic") {
      payload.image.original_base64 = await readFileAsBase64(file);
    }

    return payload;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function requestAnalysis(payload) {
  const response = await fetch("/api/analyze", {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8"
    },
    body: JSON.stringify(payload)
  });

  const result = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(result?.error || "分析请求失败。");
  }

  return result;
}

async function analyzeCurrentFile() {
  if (!currentFile) {
    return;
  }

  const mode = analyzerSelect.value;
  setStatus(mode === "heuristic" ? "启发式分析中..." : `调用 ${mode} 分析中...`, "busy");
  resetResultPanels();

  try {
    const payload = await buildAnalyzePayload(currentFile, mode);
    const result = await requestAnalysis(payload);
    renderSummary(result);
    renderTags(result);
    renderReasons(result);
    renderMetrics(result);
    renderDetails(result);
    renderJson(result);
    setStatus(
      result.runtime?.fallback_used
        ? "分析完成：已回退到 heuristic"
        : result.has_issue
          ? "分析完成：检测到问题"
          : "分析完成：未发现明显问题",
      "success"
    );
  } catch (error) {
    summaryCard.className = "summary-card empty";
    summaryCard.textContent = "分析失败";
    jsonOutput.textContent = JSON.stringify(
      {
        error: error instanceof Error ? error.message : "Unknown error"
      },
      null,
      2
    );
    setStatus(error instanceof Error ? error.message : "分析失败", "error");
  }
}

async function handleFile(file) {
  if (!file || !file.type.startsWith("image/")) {
    setStatus("请选择图片文件。", "error");
    return;
  }

  currentFile = file;
  reanalyzeButton.disabled = false;

  if (currentObjectUrl) {
    URL.revokeObjectURL(currentObjectUrl);
  }

  currentObjectUrl = URL.createObjectURL(file);
  previewImage.src = currentObjectUrl;
  previewImage.hidden = false;
  previewPlaceholder.hidden = true;
  imageMeta.textContent = `${file.name} · ${formatBytes(file.size)} · ${file.type || "unknown"}`;
  await analyzeCurrentFile();
}

fileInput.addEventListener("change", async (event) => {
  const [file] = event.target.files || [];
  if (file) {
    await handleFile(file);
  }
});

reanalyzeButton.addEventListener("click", async () => {
  await analyzeCurrentFile();
});

analyzerSelect.addEventListener("change", () => {
  updateModeCopy();
});

["dragenter", "dragover"].forEach((eventName) => {
  dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropzone.classList.add("is-dragover");
  });
});

["dragleave", "drop"].forEach((eventName) => {
  dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropzone.classList.remove("is-dragover");
  });
});

dropzone.addEventListener("drop", async (event) => {
  const [file] = event.dataTransfer?.files || [];
  if (file) {
    fileInput.files = event.dataTransfer.files;
    await handleFile(file);
  }
});

window.addEventListener("beforeunload", () => {
  if (currentObjectUrl) {
    URL.revokeObjectURL(currentObjectUrl);
  }
});

updateModeCopy();
loadAnalyzerConfig();
