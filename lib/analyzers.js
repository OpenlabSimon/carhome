import { ANALYZER_INFO as HEURISTIC_ANALYZER_INFO, ISSUE_DEFINITIONS, analyzeImageData } from "../public/js/analyzer-core.js";
import {
  ISSUE_CATALOG,
  ISSUE_TYPES,
  canonicalIssueType,
  issueCodeFromType,
  issueTypeFromCode
} from "./audit-schema.js";
import { GeminiVisionProvider, getGeminiRuntimeConfig } from "./gemini-vision-provider.js";

export const ANALYZER_MODES = ["heuristic", "gemini", "hybrid"];
export const ISSUE_TYPES_CN = [...ISSUE_TYPES];

const ORCHESTRATOR_INFO = {
  name: "auto-image-qa-orchestrator",
  type: "pipeline",
  version: "0.4.0"
};
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

const RULE_PRIORITY_ISSUES = new Set(["过曝", "偏暗", "虚图 / 模糊"]);
const SEMANTIC_ISSUES = new Set(["背景杂乱", "构图异常"]);
const RULE_PRIORITY_MARGIN = 0.08;
const RULE_REJECT_MARGIN = 0.18;
const HYBRID_NEAR_THRESHOLD_MARGIN = 0.05;
const SEVERITY_ORDER = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3
};
const OUT_OF_SCOPE_NOTE_RULES = [
  {
    keywords: ["非原厂", "涂装", "拉花"],
    note: "检测到非原厂涂装或拉花迹象，当前不在 5 标签范围内。"
  },
  {
    keywords: ["污渍", "镜头脏"],
    note: "检测到污渍或镜头脏污迹象，当前不在 5 标签范围内。"
  },
  {
    keywords: ["划痕", "掉漆", "生锈"],
    note: "检测到局部划痕、掉漆或生锈迹象，当前不在 5 标签范围内。"
  },
  {
    keywords: ["阴影", "强光"],
    note: "检测到强光或阴影过大迹象，当前不在 5 标签范围内。"
  },
  {
    keywords: ["闪光", "反光"],
    note: "检测到闪光点或强反光迹象，当前不在 5 标签范围内。"
  }
];

const clamp01 = (value) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
const round = (value, digits = 3) => Number(Number.isFinite(value) ? value : 0).toFixed(digits);

function parseRound(value, digits = 3) {
  return Number(round(value, digits));
}

function buildProviderMeta(name, model = null, protocol = null) {
  return {
    model,
    name,
    protocol
  };
}

function cloneDetail(detail) {
  return {
    ...detail,
    baseline: detail.baseline
      ? {
          ...detail.baseline,
          evidence: detail.baseline.evidence ? { ...detail.baseline.evidence } : detail.baseline.evidence
        }
      : detail.baseline,
    evidence: detail.evidence ? { ...detail.evidence } : detail.evidence
  };
}

function maxSeverity(...values) {
  return values
    .filter(Boolean)
    .reduce((best, current) => (SEVERITY_ORDER[current] > SEVERITY_ORDER[best] ? current : best), "none");
}

function isStrongRuleHit(detail) {
  if (!detail?.hit) {
    return false;
  }

  return Number(detail.score) >= Number(detail.threshold || 0) + RULE_PRIORITY_MARGIN;
}

function isStrongRuleReject(detail) {
  if (!detail || detail.hit) {
    return false;
  }

  return Number(detail.score) <= Number(detail.threshold || 1) - RULE_REJECT_MARGIN;
}

function buildIssueCatalogMap() {
  return new Map(ISSUE_CATALOG.map((item) => [item.issue_type, item]));
}

const ISSUE_MAP = buildIssueCatalogMap();

function assertMode(mode) {
  if (!ANALYZER_MODES.includes(mode)) {
    throw new Error(`Unsupported analyzer mode: ${mode}`);
  }
}

export function getAnalyzerRuntimeConfig() {
  const gemini = getGeminiRuntimeConfig();

  return {
    default_mode: "heuristic",
    gemini,
    modes: [...ANALYZER_MODES]
  };
}

export function resolveAnalyzerMode(mode = "heuristic") {
  assertMode(mode);

  const gemini = getGeminiRuntimeConfig();
  if (mode === "heuristic" || gemini.configured) {
    return {
      effectiveMode: mode,
      fallbackReason: null,
      gemini,
      requestedMode: mode
    };
  }

  return {
    effectiveMode: "heuristic",
    fallbackReason: `${mode} 模式缺少 GEMINI_API_KEY，已回退到 heuristic。`,
    gemini,
    requestedMode: mode
  };
}

function decodeBase64ToBytes(base64Value) {
  if (!base64Value) {
    return null;
  }

  return Buffer.from(base64Value, "base64");
}

function decodeRgbaPayload(rgbaBase64, expectedWidth, expectedHeight) {
  const bytes = decodeBase64ToBytes(rgbaBase64);
  if (!bytes) {
    throw new Error("Missing rgba_base64 payload.");
  }

  const expectedLength = expectedWidth * expectedHeight * 4;
  if (bytes.length !== expectedLength) {
    throw new Error(`RGBA payload length mismatch, expected ${expectedLength} bytes but received ${bytes.length}.`);
  }

  return new Uint8ClampedArray(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function buildOrchestratorMeta(mode, steps, extra = {}) {
  return {
    ...ORCHESTRATOR_INFO,
    mode,
    steps,
    ...extra
  };
}

function buildImageMeta(input) {
  return {
    analyzed_height: input.height ?? null,
    analyzed_width: input.width ?? null,
    file_size_bytes: input.fileSize ?? null,
    mime_type: input.mimeType || "image/unknown",
    name: input.imageName || "uploaded-image",
    original_height: input.originalHeight ?? input.height ?? null,
    original_width: input.originalWidth ?? input.width ?? null
  };
}

function normalizeSceneClassification(sceneClassification) {
  if (!sceneClassification?.label) {
    return null;
  }

  const normalizedViewAngle = normalizeClassifierDescriptor(sceneClassification.view_angle, VIEW_ANGLE_COPY);
  const normalizedFocusPart = normalizeClassifierDescriptor(sceneClassification.focus_part, FOCUS_PART_COPY);

  return {
    area: sceneClassification.area || null,
    confidence: parseRound(sceneClassification.confidence, 3),
    focus_part: normalizedFocusPart,
    label: sceneClassification.label,
    label_cn: SCENE_LABEL_COPY[sceneClassification.label] || sceneClassification.label,
    model: sceneClassification.model || null,
    protocol: sceneClassification.protocol || null,
    provider: sceneClassification.provider || null,
    reason: normalizeOptionalText(sceneClassification.reason),
    scope: sceneClassification.scope || null,
    view_angle: normalizedViewAngle
  };
}

function normalizeOptionalText(value) {
  const text = String(value || "").trim();
  return text || null;
}

function normalizeClassifierDescriptor(descriptor, labelCopyMap) {
  if (!descriptor?.label) {
    return null;
  }

  return {
    confidence: parseRound(descriptor.confidence, 3),
    label: descriptor.label,
    label_cn: labelCopyMap[descriptor.label] || descriptor.label,
    reason: normalizeOptionalText(descriptor.reason)
  };
}

function inferOutOfScopeNoteFromName(imageName) {
  const normalizedName = String(imageName || "");
  const notes = OUT_OF_SCOPE_NOTE_RULES
    .filter((rule) => rule.keywords.some((keyword) => normalizedName.includes(keyword)))
    .map((rule) => rule.note);

  return notes.length ? [...new Set(notes)].join("；") : null;
}

function resolveOutOfScopeNote({ imageName, providerNote = null }) {
  return normalizeOptionalText(providerNote) || inferOutOfScopeNoteFromName(imageName);
}

function buildHitSummary(details) {
  const hitDetails = details.filter((detail) => detail.hit);
  const topScore = details.reduce((max, detail) => Math.max(max, detail.score), 0);
  const maxHitScore = hitDetails.reduce((max, detail) => Math.max(max, detail.score), 0);
  const hasIssue = hitDetails.length > 0;
  const severity = !hasIssue ? "none" : maxHitScore >= 0.82 ? "high" : maxHitScore >= 0.68 ? "medium" : "low";
  const confidence = hasIssue ? clamp01(0.56 + maxHitScore * 0.4) : clamp01(Math.max(0.56, 0.92 - topScore * 0.36));

  return {
    confidence: parseRound(confidence, 3),
    hasIssue,
    issueTypes: hitDetails.map((detail) => detail.issue_type),
    reasons: hitDetails.map((detail) => detail.reason),
    severity
  };
}

function deriveDecision(summary, preferredDecision = null, outOfScopeNote = null) {
  if (!summary.hasIssue) {
    return normalizeOptionalText(outOfScopeNote) || preferredDecision === "out_of_scope" ? "out_of_scope" : "pass";
  }

  if (preferredDecision === "fail" || preferredDecision === "risk") {
    return preferredDecision;
  }

  return summary.confidence >= 0.9 && summary.severity === "high" ? "fail" : "risk";
}

function deriveReviewRecommendation(decision, preferredRecommendation = null) {
  if (decision === "out_of_scope") {
    return "manual_review";
  }

  if (preferredRecommendation === "auto_pass" || preferredRecommendation === "manual_review" || preferredRecommendation === "auto_fail") {
    return preferredRecommendation;
  }

  if (decision === "pass") {
    return "auto_pass";
  }

  if (decision === "fail") {
    return "auto_fail";
  }

  return "manual_review";
}

function buildIssuesFromDetails(details) {
  return details
    .filter((detail) => detail.hit)
    .map((detail) => ({
      code: issueCodeFromType(detail.issue_type),
      confidence: detail.confidence ?? detail.score,
      label: detail.issue_type,
      reason: detail.reason,
      severity: detail.severity,
      source: detail.source
    }));
}

function attachAuditOutcome(result, { preferredDecision = null, preferredRecommendation = null } = {}) {
  const summary = buildHitSummary(result.details);
  const decision = deriveDecision(summary, preferredDecision, result.out_of_scope_note);
  const reviewRecommendation = deriveReviewRecommendation(decision, preferredRecommendation);

  return {
    ...result,
    confidence: summary.confidence,
    decision,
    has_issue: summary.hasIssue,
    issue_types: summary.issueTypes,
    issues: buildIssuesFromDetails(result.details),
    reasons: summary.reasons,
    review_recommendation: reviewRecommendation,
    severity: summary.severity
  };
}

function normalizeHeuristicDetails(details) {
  return details.map((detail) => ({
    ...detail,
    code: issueCodeFromType(detail.issue_type),
    confidence: detail.score,
    source: "heuristic"
  }));
}

function makeHeuristicResult(input) {
  const rgba = decodeRgbaPayload(input.rgbaBase64, input.width, input.height);
  const heuristicResult = analyzeImageData({
    data: rgba,
    width: input.width,
    height: input.height,
    imageName: input.imageName,
    mimeType: input.mimeType,
    fileSize: input.fileSize,
    originalWidth: input.originalWidth,
    originalHeight: input.originalHeight
  });

  const details = normalizeHeuristicDetails(heuristicResult.details);

  return attachAuditOutcome(
    {
      analyzer: buildOrchestratorMeta("heuristic", [
        {
          analyzer: HEURISTIC_ANALYZER_INFO,
          step: "heuristic"
        }
      ]),
      details,
      image: heuristicResult.image,
      metrics: heuristicResult.metrics,
      out_of_scope_note: resolveOutOfScopeNote({
        imageName: input.imageName
      }),
      provider: buildProviderMeta("heuristic", null, null)
    },
    {}
  );
}

function buildMissingVisionLabel(issueType, source, baseline = null) {
  const issueMeta = ISSUE_MAP.get(issueType);

  return {
    baseline,
    code: issueMeta?.code || null,
    confidence: 0.05,
    definition: ISSUE_DEFINITIONS[issueType],
    evidence: {
      model_confidence: 0.05
    },
    hit: false,
    issue_type: issueType,
    reason: "Gemini 未返回该标签，按未命中处理。",
    score: 0.05,
    severity: "none",
    source,
    threshold: 0.5
  };
}

function isNearThreshold(detail, margin = HYBRID_NEAR_THRESHOLD_MARGIN) {
  return Math.abs(Number(detail?.score ?? 0) - Number(detail?.threshold ?? 0)) <= margin;
}

function resolveHybridShortCircuit(heuristicResult) {
  const details = heuristicResult?.details || [];
  if (!details.length) {
    return {
      reason: "no_details",
      shouldShortCircuit: true
    };
  }

  const hitDetails = details.filter((detail) => detail.hit);
  const allRulePriorityHits =
    hitDetails.length > 0 &&
    hitDetails.every((detail) => RULE_PRIORITY_ISSUES.has(detail.issue_type));

  if (allRulePriorityHits) {
    return {
      reason: "rule_priority_hit",
      shouldShortCircuit: true
    };
  }

  if (details.some((detail) => isNearThreshold(detail))) {
    return {
      reason: "near_threshold",
      shouldShortCircuit: false
    };
  }

  if (!heuristicResult.has_issue) {
    return {
      reason: heuristicResult.decision === "out_of_scope" ? "out_of_scope_only" : "clear_pass",
      shouldShortCircuit: true
    };
  }

  const allHitsStrong =
    hitDetails.length > 0 &&
    hitDetails.every((detail) => Number(detail.score) >= Number(detail.threshold || 0) + RULE_PRIORITY_MARGIN);

  return {
    reason: allHitsStrong ? "clear_hit" : "mixed_signal",
    shouldShortCircuit: allHitsStrong
  };
}

function buildHybridShortCircuitResult(heuristicResult, reason, sceneClassification = null) {
  const scene = normalizeSceneClassification(sceneClassification);
  const steps = [];

  if (scene) {
    steps.push({
      analyzer: {
        name: "gemini-scene-classifier",
        type: "vlm",
        version: "0.1.0"
      },
      model: scene.model,
      protocol: scene.protocol,
      step: "scene"
    });
  }

  steps.push({
    analyzer: HEURISTIC_ANALYZER_INFO,
    step: "heuristic"
  });

  return {
    ...heuristicResult,
    analyzer: buildOrchestratorMeta("hybrid", steps, {
      gemini: getGeminiRuntimeConfig(),
      hybrid_policy: {
        short_circuit_reason: reason,
        short_circuit_used: true
      }
    }),
    baseline: {
      analyzer: heuristicResult.analyzer,
      confidence: heuristicResult.confidence,
      details: heuristicResult.details,
      decision: heuristicResult.decision,
      has_issue: heuristicResult.has_issue,
      issue_types: heuristicResult.issue_types,
      reasons: heuristicResult.reasons,
      review_recommendation: heuristicResult.review_recommendation,
      severity: heuristicResult.severity
    },
    hybrid_policy: {
      short_circuit_reason: reason,
      short_circuit_used: true
    },
    focus_part: scene?.focus_part || null,
    scene,
    view_angle: scene?.view_angle || null,
    provider: buildProviderMeta("heuristic", null, null)
  };
}

function applySceneAwareAdjustments(details, heuristicResult, sceneClassification) {
  const scene = normalizeSceneClassification(sceneClassification);
  if (!scene) {
    return {
      details,
      sceneAdjustedIssues: [],
      sceneRuleApplied: false
    };
  }

  const mergedByType = new Map(details.map((detail) => [detail.issue_type, cloneDetail(detail)]));
  const baselineByType = new Map((heuristicResult?.details || []).map((detail) => [detail.issue_type, detail]));
  const sceneAdjustedIssues = [];

  function sceneAllowsRuleOverride(issueType) {
    const baseline = baselineByType.get(issueType);
    return baseline?.hit && isStrongRuleHit(baseline);
  }

  function veto(issueType, reason) {
    const current = mergedByType.get(issueType);
    if (!current?.hit) {
      return;
    }

    if (sceneAllowsRuleOverride(issueType)) {
      return;
    }

    sceneAdjustedIssues.push(issueType);
    mergedByType.set(issueType, {
      ...current,
      confidence: parseRound(Math.min(current.confidence ?? current.score ?? 0, 0.49), 3),
      hit: false,
      reason,
      score: parseRound(Math.min(current.score ?? 0, 0.49), 3),
      severity: "none",
      source: "scene-classifier-veto"
    });
  }

  if (scene.label === "partial_interior") {
    veto("构图异常", "场景先验：当前为局部内饰图，未展示整车或内饰近景不单独构成构图异常。");
    veto("背景杂乱", "场景先验：当前为局部内饰图，窗外车辆或环境不单独构成背景杂乱。");
  }

  if (scene.label === "partial_exterior") {
    veto("构图异常", "场景先验：当前为局部外观图，局部特写或近景裁切不单独构成构图异常。");
  }

  return {
    details: ISSUE_TYPES.map((issueType) => mergedByType.get(issueType)),
    sceneAdjustedIssues,
    sceneRuleApplied: sceneAdjustedIssues.length > 0
  };
}

function normalizeVisionDetails({ issues, source, heuristicResult }) {
  const baselineMap = new Map((heuristicResult?.details || []).map((detail) => [detail.issue_type, detail]));
  const rawByType = new Map();

  for (const issue of Array.isArray(issues) ? issues : []) {
    const issueType = issueTypeFromCode(issue.code) || canonicalIssueType(issue.label || issue.issue_type);
    if (!issueType || rawByType.has(issueType)) {
      continue;
    }

    const baseline = baselineMap.get(issueType);
    rawByType.set(issueType, {
      baseline: baseline
        ? {
            evidence: baseline.evidence,
            hit: baseline.hit,
            reason: baseline.reason,
            score: baseline.score,
            severity: baseline.severity,
            threshold: baseline.threshold
          }
        : null,
      code: issueCodeFromType(issueType),
      confidence: parseRound(issue.confidence, 3),
      definition: ISSUE_DEFINITIONS[issueType],
      evidence: {
        model_confidence: parseRound(issue.confidence, 3)
      },
      hit: true,
      issue_type: issueType,
      reason: String(issue.reason || `${issueType} 命中。`).trim(),
      score: parseRound(issue.confidence, 3),
      severity: issue.severity,
      source,
      threshold: 0.5
    });
  }

  return ISSUE_TYPES.map((issueType) => rawByType.get(issueType) || buildMissingVisionLabel(issueType, source, baselineMap.get(issueType) || null));
}

function applyHybridRulePriority(details, heuristicResult) {
  const mergedByType = new Map(details.map((detail) => [detail.issue_type, cloneDetail(detail)]));
  const baselineByType = new Map((heuristicResult?.details || []).map((detail) => [detail.issue_type, detail]));
  const authoritativeIssues = [];
  const promotedIssues = [];
  const vetoedIssues = [];

  for (const issueType of RULE_PRIORITY_ISSUES) {
    const baseline = baselineByType.get(issueType);
    const current = mergedByType.get(issueType);
    if (baseline?.hit) {
      authoritativeIssues.push(issueType);
      mergedByType.set(issueType, {
        ...current,
        baseline: {
          evidence: baseline.evidence,
          hit: baseline.hit,
          reason: baseline.reason,
          score: baseline.score,
          severity: baseline.severity,
          threshold: baseline.threshold
        },
        confidence: parseRound(Math.max(current?.confidence ?? 0, baseline.score), 3),
        evidence: {
          ...(current?.evidence || {}),
          rule_score: parseRound(baseline.score, 3)
        },
        hit: true,
        reason: current?.hit
          ? `规则主判：${baseline.reason}；模型补充：${current.reason}`
          : `规则主判：${baseline.reason}`,
        score: parseRound(Math.max(current?.score ?? 0, baseline.score), 3),
        severity: maxSeverity(current?.severity, baseline.severity),
        source: "hybrid-rule-priority",
        threshold: baseline.threshold
      });
      continue;
    }

    if (current?.hit) {
      vetoedIssues.push(issueType);
      mergedByType.set(issueType, {
        ...current,
        confidence: parseRound(Math.min(current.confidence ?? current.score ?? 0, 0.49), 3),
        hit: false,
        reason: `P0 标签需规则命中支撑，${issueType} 在 hybrid 中按未命中处理。`,
        score: parseRound(Math.min(current.score ?? 0, 0.49), 3),
        severity: "none",
        source: "hybrid-rule-veto"
      });
    }
  }

  if (authoritativeIssues.length > 0) {
    for (const issueType of SEMANTIC_ISSUES) {
      const current = mergedByType.get(issueType);
      const baseline = baselineByType.get(issueType);
      if (!current?.hit) {
        continue;
      }

      if (baseline?.hit && isStrongRuleHit(baseline)) {
        continue;
      }

      mergedByType.set(issueType, {
        ...current,
        confidence: parseRound(Math.min(current.confidence ?? current.score ?? 0, 0.49), 3),
        hit: false,
        reason: `规则优先：已有更明确的曝光或清晰度问题，${issueType} 暂不单独成立。`,
        score: parseRound(Math.min(current.score ?? 0, 0.49), 3),
        severity: "none",
        source: "hybrid-rule-priority-veto"
      });
    }
  }

  for (const issueType of SEMANTIC_ISSUES) {
    const baseline = baselineByType.get(issueType);
    const current = mergedByType.get(issueType);

    if (baseline?.hit && !current?.hit) {
      promotedIssues.push(issueType);
      mergedByType.set(issueType, {
        ...current,
        baseline: {
          evidence: baseline.evidence,
          hit: baseline.hit,
          reason: baseline.reason,
          score: baseline.score,
          severity: baseline.severity,
          threshold: baseline.threshold
        },
        confidence: parseRound(Math.max(current?.confidence ?? 0, baseline.score), 3),
        evidence: {
          ...(current?.evidence || {}),
          rule_score: parseRound(baseline.score, 3)
        },
        hit: true,
        reason: `规则补充：${baseline.reason}`,
        score: parseRound(Math.max(current?.score ?? 0, baseline.score), 3),
        severity: maxSeverity(current?.severity, baseline.severity),
        source: "hybrid-semantic-promotion",
        threshold: baseline.threshold
      });
      continue;
    }

    if (current?.hit && !baseline?.hit) {
      vetoedIssues.push(issueType);
      mergedByType.set(issueType, {
        ...current,
        confidence: parseRound(Math.min(current.confidence ?? current.score ?? 0, 0.49), 3),
        hit: false,
        reason: `规则未支持该语义标签，${issueType} 在 hybrid 中按未命中处理。`,
        score: parseRound(Math.min(current.score ?? 0, 0.49), 3),
        severity: "none",
        source: "hybrid-semantic-veto"
      });
    }
  }

  return {
    details: ISSUE_TYPES.map((issueType) => mergedByType.get(issueType)),
    authoritativeIssues,
    promotedIssues,
    rulePriorityApplied: authoritativeIssues.length > 0 || promotedIssues.length > 0 || vetoedIssues.length > 0,
    vetoedIssues
  };
}

function buildVisionResult({ input, geminiOutput, heuristicResult = null, mode }) {
  const source = mode === "hybrid" ? "hybrid" : "gemini";
  const normalizedDetails = normalizeVisionDetails({
    heuristicResult,
    issues: geminiOutput.issues,
    source
  });
  const hybridPolicy =
    mode === "hybrid" && heuristicResult
      ? applyHybridRulePriority(normalizedDetails, heuristicResult)
      : {
          authoritativeIssues: [],
          details: normalizedDetails,
          promotedIssues: [],
          rulePriorityApplied: false,
          vetoedIssues: []
        };
  const scenePolicy = applySceneAwareAdjustments(hybridPolicy.details, heuristicResult, geminiOutput.scene);
  const details = scenePolicy.details;
  const hitIssueTypes = details.filter((detail) => detail?.hit).map((detail) => detail.issue_type);
  const hasHighSeverityHit = details.some(
    (detail) => detail?.hit && (detail.severity === "high" || Number(detail.score) >= 0.9)
  );
  const hasOnlySemanticHits =
    hitIssueTypes.length > 0 &&
    hitIssueTypes.every((issueType) => SEMANTIC_ISSUES.has(issueType));

  const steps = [];
  if (geminiOutput.scene?.label) {
    steps.push({
      analyzer: {
        name: "gemini-scene-classifier",
        type: "vlm",
        version: "0.1.0"
      },
      model: geminiOutput.scene.model,
      protocol: geminiOutput.scene.protocol,
      step: "scene"
    });
  }
  if (heuristicResult) {
    steps.push({
      analyzer: HEURISTIC_ANALYZER_INFO,
      step: "heuristic"
    });
  }
  steps.push({
    analyzer: {
      name: "gemini-vision-provider",
      type: "vlm",
      version: "0.4.0"
    },
    model: geminiOutput.model,
    protocol: geminiOutput.protocol,
    step: "gemini"
  });

  const result = attachAuditOutcome(
    {
      analyzer: buildOrchestratorMeta(mode, steps, {
        gemini: getGeminiRuntimeConfig(),
        hybrid_policy:
          mode === "hybrid"
            ? {
                authoritative_issues: hybridPolicy.authoritativeIssues,
                promoted_issues: hybridPolicy.promotedIssues,
                rule_priority_applied: hybridPolicy.rulePriorityApplied,
                scene_adjusted_issues: scenePolicy.sceneAdjustedIssues,
                scene_rule_applied: scenePolicy.sceneRuleApplied,
                vetoed_issues: hybridPolicy.vetoedIssues
              }
            : null
      }),
      details,
      gemini: {
        model: geminiOutput.model,
        overall_summary: geminiOutput.summary,
        protocol: geminiOutput.protocol,
        provider: geminiOutput.provider
      },
      image: {
        ...buildImageMeta(input),
        analyzed_height: heuristicResult?.image?.analyzed_height ?? input.height ?? null,
        analyzed_width: heuristicResult?.image?.analyzed_width ?? input.width ?? null
      },
      metrics: heuristicResult?.metrics ?? null,
      out_of_scope_note: resolveOutOfScopeNote({
        imageName: input.imageName,
        providerNote: geminiOutput.outOfScopeNote
      }),
      provider: buildProviderMeta(geminiOutput.provider, geminiOutput.model, geminiOutput.protocol)
    },
    {
      preferredDecision: hybridPolicy.rulePriorityApplied
        ? geminiOutput.decision === "fail" && hasHighSeverityHit
          ? "fail"
          : null
        : hasOnlySemanticHits && geminiOutput.decision === "fail"
          ? "risk"
          : geminiOutput.decision,
      preferredRecommendation: hybridPolicy.rulePriorityApplied
        ? geminiOutput.reviewRecommendation === "auto_fail" && hasHighSeverityHit
          ? "auto_fail"
          : null
        : hasOnlySemanticHits && geminiOutput.reviewRecommendation === "auto_fail"
          ? "manual_review"
          : geminiOutput.reviewRecommendation
    }
  );

  if (heuristicResult) {
    result.baseline = {
      analyzer: heuristicResult.analyzer,
      confidence: heuristicResult.confidence,
      details: heuristicResult.details,
      decision: heuristicResult.decision,
      has_issue: heuristicResult.has_issue,
      issue_types: heuristicResult.issue_types,
      reasons: heuristicResult.reasons,
      review_recommendation: heuristicResult.review_recommendation,
      severity: heuristicResult.severity
    };
    result.hybrid_policy = {
      authoritative_issues: hybridPolicy.authoritativeIssues,
      promoted_issues: hybridPolicy.promotedIssues,
      rule_priority_applied: hybridPolicy.rulePriorityApplied,
      scene_adjusted_issues: scenePolicy.sceneAdjustedIssues,
      scene_rule_applied: scenePolicy.sceneRuleApplied,
      vetoed_issues: hybridPolicy.vetoedIssues
    };
  }

  result.scene = normalizeSceneClassification(geminiOutput.scene);
  result.view_angle = result.scene?.view_angle || null;
  result.focus_part = result.scene?.focus_part || null;

  return result;
}

function buildAnalysisInput(params) {
  return {
    brand: params.brand || null,
    declaredColor: params.declaredColor || null,
    fileSize: params.fileSize ?? null,
    height: params.height ?? null,
    imageName: params.imageName || "uploaded-image",
    listingId: params.listingId || null,
    mimeType: params.mimeType || "image/unknown",
    mode: params.mode || "heuristic",
    model: params.model || null,
    originalBase64: params.originalBase64 || null,
    originalHeight: params.originalHeight ?? null,
    originalWidth: params.originalWidth ?? null,
    requestedLabels: params.requestedLabels || ISSUE_CATALOG.map((item) => item.code),
    rgbaBase64: params.rgbaBase64 || null,
    width: params.width ?? null
  };
}

export async function analyzeWithMode(params) {
  const input = buildAnalysisInput(params);
  assertMode(input.mode);

  if (input.mode === "heuristic") {
    return makeHeuristicResult(input);
  }

  const provider = new GeminiVisionProvider();

  if (input.mode === "gemini") {
    const sceneClassification = await provider.classifyScene({
      imageBase64: input.originalBase64,
      metadata: {
        brand: input.brand,
        declaredColor: input.declaredColor,
        listingId: input.listingId,
        model: input.model
      },
      mimeType: input.mimeType
    });
    const geminiOutput = await provider.auditImage({
      imageBase64: input.originalBase64,
      metadata: {
        brand: input.brand,
        declaredColor: input.declaredColor,
        listingId: input.listingId,
        model: input.model
      },
      mimeType: input.mimeType,
      mode: input.mode,
      sceneClassification
    });

    return buildVisionResult({
      geminiOutput,
      heuristicResult: null,
      input,
      mode: input.mode
    });
  }

  const sceneClassification = await provider.classifyScene({
    imageBase64: input.originalBase64,
    metadata: {
      brand: input.brand,
      declaredColor: input.declaredColor,
      listingId: input.listingId,
      model: input.model
    },
    mimeType: input.mimeType
  });
  const heuristicResult = makeHeuristicResult(input);
  const shortCircuit = resolveHybridShortCircuit(heuristicResult);
  if (shortCircuit.shouldShortCircuit) {
    return buildHybridShortCircuitResult(heuristicResult, shortCircuit.reason, sceneClassification);
  }
  const geminiOutput = await provider.auditImage({
    heuristicResult,
    imageBase64: input.originalBase64,
    metadata: {
      brand: input.brand,
      declaredColor: input.declaredColor,
      listingId: input.listingId,
      model: input.model
    },
    mimeType: input.mimeType,
    mode: input.mode,
    sceneClassification
  });

  return buildVisionResult({
    geminiOutput,
    heuristicResult,
    input,
    mode: input.mode
  });
}

function withRuntime(result, runtime) {
  return {
    ...result,
    runtime
  };
}

export async function runAnalysisPipeline(input) {
  const runtime = resolveAnalyzerMode(input.mode || "heuristic");

  try {
    const result = await analyzeWithMode({
      ...input,
      mode: runtime.effectiveMode
    });

    return withRuntime(result, {
      attempted_mode: runtime.effectiveMode,
      effective_mode: runtime.effectiveMode,
      fallback_reason: runtime.fallbackReason,
      fallback_used: Boolean(runtime.fallbackReason),
      gemini: runtime.gemini,
      provider: result.provider,
      requested_mode: runtime.requestedMode
    });
  } catch (error) {
    if (runtime.effectiveMode === "heuristic") {
      throw error;
    }

    if (!input.rgbaBase64 || !input.width || !input.height) {
      throw error;
    }

    const heuristicResult = makeHeuristicResult(buildAnalysisInput({
      ...input,
      mode: "heuristic"
    }));
    const failureReason = error instanceof Error ? error.message : "Gemini analyzer failed.";

    return withRuntime(heuristicResult, {
      attempted_mode: runtime.effectiveMode,
      effective_mode: "heuristic",
      fallback_reason: `Gemini 调用失败，已回退到 heuristic。${failureReason}`,
      fallback_used: true,
      failure_reason: failureReason,
      gemini: runtime.gemini,
      provider: heuristicResult.provider,
      requested_mode: runtime.requestedMode
    });
  }
}
