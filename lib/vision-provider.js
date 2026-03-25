import { ISSUE_CODES, canonicalIssueCode } from "./audit-schema.js";

export const AUDIT_DECISIONS = ["pass", "risk", "fail", "out_of_scope"];
export const REVIEW_RECOMMENDATIONS = ["auto_pass", "manual_review", "auto_fail"];
export const ISSUE_SEVERITIES = ["low", "medium", "high"];
export const SCENE_LABELS = ["full_exterior", "partial_exterior", "partial_interior", "vehicle_accessory"];
export const SCENE_SCOPES = ["full", "partial"];
export const SCENE_AREAS = ["exterior", "interior", "accessory"];
export const VIEW_ANGLE_LABELS = [
  "front",
  "front_45",
  "side",
  "rear_45",
  "rear",
  "interior_driver",
  "interior_center",
  "interior_rear",
  "detail",
  "unknown"
];
export const FOCUS_PART_LABELS = [
  "full_vehicle",
  "front_face",
  "rear_face",
  "engine_bay",
  "fuel_cap",
  "wheel",
  "headlight",
  "taillight",
  "grille",
  "mirror",
  "door_exterior",
  "door_interior",
  "pillar_trim",
  "steering_wheel",
  "dashboard",
  "center_console",
  "seat",
  "rear_space",
  "trunk",
  "roof",
  "screen",
  "air_vent",
  "control_panel",
  "cup_holder",
  "charging_port",
  "pedal",
  "vin_plate",
  "key_fob",
  "badge",
  "window",
  "unknown"
];

const SCENE_LABEL_META = new Map([
  ["full_exterior", { area: "exterior", scope: "full" }],
  ["partial_exterior", { area: "exterior", scope: "partial" }],
  ["partial_interior", { area: "interior", scope: "partial" }],
  ["vehicle_accessory", { area: "accessory", scope: "partial" }]
]);

const clamp01 = (value) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
const round = (value, digits = 3) => Number(Number(value).toFixed(digits));

function asNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function deriveDecision(issues, outOfScopeNote = null) {
  if (!issues.length) {
    return String(outOfScopeNote || "").trim() ? "out_of_scope" : "pass";
  }

  const topIssue = issues.reduce((max, issue) => (issue.confidence > max.confidence ? issue : max), issues[0]);
  if (topIssue.confidence >= 0.9 && topIssue.severity === "high") {
    return "fail";
  }

  return "risk";
}

function normalizeDecision(value, issues, outOfScopeNote = null) {
  const normalized = String(value || "").trim().toLowerCase();
  if (AUDIT_DECISIONS.includes(normalized)) {
    if (normalized === "out_of_scope") {
      return issues.length ? deriveDecision(issues, null) : "out_of_scope";
    }

    if (!issues.length) {
      return deriveDecision(issues, outOfScopeNote);
    }

    return normalized === "pass" ? "risk" : normalized;
  }

  return deriveDecision(issues, outOfScopeNote);
}

function normalizeReviewRecommendation(value, decision) {
  const normalized = String(value || "").trim().toLowerCase();
  if (decision === "out_of_scope") {
    return "manual_review";
  }

  if (REVIEW_RECOMMENDATIONS.includes(normalized)) {
    return normalized;
  }

  if (decision === "pass") {
    return "auto_pass";
  }

  if (decision === "fail") {
    return "auto_fail";
  }

  return "manual_review";
}

function normalizeSeverity(value, confidence) {
  const normalized = String(value || "").trim().toLowerCase();
  if (ISSUE_SEVERITIES.includes(normalized)) {
    return normalized;
  }

  if (confidence >= 0.9) {
    return "high";
  }

  if (confidence >= 0.7) {
    return "medium";
  }

  return "low";
}

function canonicalEnumLabel(value, aliases) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/gu, "_");

  if (!normalized) {
    return null;
  }

  return aliases.get(normalized) || null;
}

function canonicalSceneLabel(value) {
  const aliases = new Map([
    ["full_exterior", "full_exterior"],
    ["full_vehicle_exterior", "full_exterior"],
    ["exterior_full", "full_exterior"],
    ["whole_exterior", "full_exterior"],
    ["complete_exterior", "full_exterior"],
    ["partial_exterior", "partial_exterior"],
    ["exterior_partial", "partial_exterior"],
    ["partial_outside", "partial_exterior"],
    ["partial_outer", "partial_exterior"],
    ["partial_interior", "partial_interior"],
    ["interior_partial", "partial_interior"],
    ["partial_inside", "partial_interior"],
    ["interior_detail", "partial_interior"],
    ["vehicle_accessory", "vehicle_accessory"],
    ["accessory", "vehicle_accessory"],
    ["accessory_detail", "vehicle_accessory"],
    ["vehicle_item", "vehicle_accessory"],
    ["key_accessory", "vehicle_accessory"]
  ]);

  return canonicalEnumLabel(value, aliases);
}

function canonicalViewAngle(value) {
  const aliases = new Map([
    ["front", "front"],
    ["front_view", "front"],
    ["front_center", "front"],
    ["front_45", "front_45"],
    ["front_three_quarter", "front_45"],
    ["front_three_quarters", "front_45"],
    ["front45", "front_45"],
    ["front_angle", "front_45"],
    ["side", "side"],
    ["side_view", "side"],
    ["profile", "side"],
    ["rear_45", "rear_45"],
    ["rear_three_quarter", "rear_45"],
    ["rear_three_quarters", "rear_45"],
    ["rear45", "rear_45"],
    ["rear_angle", "rear_45"],
    ["rear", "rear"],
    ["rear_view", "rear"],
    ["rear_center", "rear"],
    ["interior_driver", "interior_driver"],
    ["driver_view", "interior_driver"],
    ["driver_seat", "interior_driver"],
    ["interior_center", "interior_center"],
    ["center_console_view", "interior_center"],
    ["center_view", "interior_center"],
    ["interior_rear", "interior_rear"],
    ["rear_seat_view", "interior_rear"],
    ["rear_cabin", "interior_rear"],
    ["detail", "detail"],
    ["detail_closeup", "detail"],
    ["closeup", "detail"],
    ["macro", "detail"],
    ["unknown", "unknown"]
  ]);

  return canonicalEnumLabel(value, aliases);
}

function canonicalFocusPart(value) {
  const aliases = new Map([
    ["full_vehicle", "full_vehicle"],
    ["whole_vehicle", "full_vehicle"],
    ["entire_vehicle", "full_vehicle"],
    ["front_face", "front_face"],
    ["front", "front_face"],
    ["front_end", "front_face"],
    ["rear_face", "rear_face"],
    ["rear", "rear_face"],
    ["rear_end", "rear_face"],
    ["engine_bay", "engine_bay"],
    ["engine_compartment", "engine_bay"],
    ["engine_room", "engine_bay"],
    ["hood_inner", "engine_bay"],
    ["fuel_cap", "fuel_cap"],
    ["fuel_door", "fuel_cap"],
    ["fuel_filler", "fuel_cap"],
    ["fuel_port", "fuel_cap"],
    ["wheel", "wheel"],
    ["wheel_tire", "wheel"],
    ["rim", "wheel"],
    ["headlight", "headlight"],
    ["front_light", "headlight"],
    ["taillight", "taillight"],
    ["rear_light", "taillight"],
    ["grille", "grille"],
    ["grill", "grille"],
    ["mirror", "mirror"],
    ["side_mirror", "mirror"],
    ["door_exterior", "door_exterior"],
    ["outer_door_panel", "door_exterior"],
    ["door_panel_exterior", "door_exterior"],
    ["door_interior", "door_interior"],
    ["inner_door_panel", "door_interior"],
    ["door_panel_interior", "door_interior"],
    ["pillar_trim", "pillar_trim"],
    ["a_pillar", "pillar_trim"],
    ["b_pillar", "pillar_trim"],
    ["c_pillar", "pillar_trim"],
    ["pillar", "pillar_trim"],
    ["pillar_cover", "pillar_trim"],
    ["steering_wheel", "steering_wheel"],
    ["dashboard", "dashboard"],
    ["instrument_panel", "dashboard"],
    ["center_console", "center_console"],
    ["console", "center_console"],
    ["seat", "seat"],
    ["rear_space", "rear_space"],
    ["rear_seat", "rear_space"],
    ["rear_cabin", "rear_space"],
    ["trunk", "trunk"],
    ["cargo_area", "trunk"],
    ["roof", "roof"],
    ["roof_liner", "roof"],
    ["headliner", "roof"],
    ["screen", "screen"],
    ["display", "screen"],
    ["air_vent", "air_vent"],
    ["vent", "air_vent"],
    ["control_panel", "control_panel"],
    ["climate_panel", "control_panel"],
    ["button_panel", "control_panel"],
    ["cup_holder", "cup_holder"],
    ["cupholder", "cup_holder"],
    ["charging_port", "charging_port"],
    ["usb_port", "charging_port"],
    ["power_port", "charging_port"],
    ["pedal", "pedal"],
    ["pedals", "pedal"],
    ["accelerator", "pedal"],
    ["brake_pedal", "pedal"],
    ["footwell", "pedal"],
    ["vin_plate", "vin_plate"],
    ["vin_label", "vin_plate"],
    ["nameplate", "vin_plate"],
    ["key_fob", "key_fob"],
    ["car_key", "key_fob"],
    ["smart_key", "key_fob"],
    ["remote_key", "key_fob"],
    ["key", "key_fob"],
    ["badge", "badge"],
    ["logo", "badge"],
    ["emblem", "badge"],
    ["window", "window"],
    ["glass", "window"],
    ["unknown", "unknown"]
  ]);

  return canonicalEnumLabel(value, aliases);
}

function normalizeDescriptorPayload(rawDescriptor, canonicalize) {
  if (!rawDescriptor) {
    return null;
  }

  const descriptor =
    typeof rawDescriptor === "object"
      ? rawDescriptor
      : {
          label: rawDescriptor
        };
  const label = canonicalize(
    descriptor.label ||
      descriptor.code ||
      descriptor.type ||
      descriptor.category
  );

  if (!label) {
    return null;
  }

  return {
    confidence: round(clamp01(asNumber(descriptor.confidence ?? descriptor.score, 0.5))),
    label,
    reason: String(descriptor.reason || descriptor.summary || "").trim() || null
  };
}

export function validateFocusPartPayload(payload) {
  return normalizeDescriptorPayload(
    payload?.focus_part || payload?.focusPart || payload,
    canonicalFocusPart
  );
}

export function validateSceneClassificationPayload(payload) {
  const rawScene = payload?.scene || payload?.sceneClassification || payload;
  const label = canonicalSceneLabel(
    rawScene?.label ||
      rawScene?.scene_label ||
      rawScene?.sceneType ||
      rawScene?.scene_type ||
      rawScene?.type ||
      rawScene?.category
  );

  if (!label) {
    return null;
  }

  const meta = SCENE_LABEL_META.get(label);
  const confidence = round(clamp01(asNumber(rawScene?.confidence ?? rawScene?.score, 0.5)));
  const reason = String(rawScene?.reason || rawScene?.summary || "").trim();
  const viewAngle = normalizeDescriptorPayload(
    payload?.view_angle ||
      payload?.viewAngle ||
      rawScene?.view_angle ||
      rawScene?.viewAngle || {
        confidence: rawScene?.view_angle_confidence || rawScene?.viewAngleConfidence,
        label: rawScene?.view_angle_label || rawScene?.viewAngleLabel || rawScene?.angle,
        reason: rawScene?.view_angle_reason || rawScene?.viewAngleReason
      },
    canonicalViewAngle
  );
  const focusPart = normalizeDescriptorPayload(
    payload?.focus_part ||
      payload?.focusPart ||
      rawScene?.focus_part ||
      rawScene?.focusPart || {
        confidence: rawScene?.focus_part_confidence || rawScene?.focusPartConfidence,
        label: rawScene?.focus_part_label || rawScene?.focusPartLabel || rawScene?.part,
        reason: rawScene?.focus_part_reason || rawScene?.focusPartReason
      },
    canonicalFocusPart
  );

  return {
    area: meta?.area || "exterior",
    confidence,
    focus_part: focusPart,
    label,
    reason: reason || null,
    scope: meta?.scope || "full",
    view_angle: viewAngle
  };
}

export class VisionProviderError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "VisionProviderError";
    this.provider = options.provider || "unknown";
    this.retryable = Boolean(options.retryable);
    this.cause = options.cause;
  }
}

export function validateVisionAuditPayload(payload) {
  const dedupedIssues = [];
  const seenCodes = new Set();

  for (const rawIssue of Array.isArray(payload?.issues) ? payload.issues : []) {
    const code = canonicalIssueCode(rawIssue?.code || rawIssue?.issue_code || rawIssue?.issue_type || rawIssue?.label);
    if (!code || seenCodes.has(code) || !ISSUE_CODES.includes(code)) {
      continue;
    }

    const confidence = round(clamp01(asNumber(rawIssue?.confidence ?? rawIssue?.score, 0.5)));
    dedupedIssues.push({
      code,
      confidence,
      severity: normalizeSeverity(rawIssue?.severity, confidence),
      reason: String(rawIssue?.reason || `${code} 命中。`).trim()
    });
    seenCodes.add(code);
  }

  const outOfScopeNote = String(payload?.outOfScopeNote || payload?.out_of_scope_note || "").trim();
  const decision = normalizeDecision(payload?.decision, dedupedIssues, outOfScopeNote);
  const reviewRecommendation = normalizeReviewRecommendation(
    payload?.reviewRecommendation || payload?.review_recommendation,
    decision
  );
  const normalizedSummary = String(payload?.summary || payload?.overall_summary || "").trim();

  return {
    decision,
    issues: decision === "pass" || decision === "out_of_scope" ? [] : dedupedIssues,
    outOfScopeNote: outOfScopeNote || null,
    reviewRecommendation,
    summary: normalizedSummary
  };
}
