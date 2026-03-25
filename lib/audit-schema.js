import { ISSUE_DEFINITIONS } from "../public/js/analyzer-core.js";

export const ISSUE_CATALOG = [
  {
    code: "exposure_over",
    definition: ISSUE_DEFINITIONS["过曝"],
    issue_type: "过曝"
  },
  {
    code: "exposure_under",
    definition: ISSUE_DEFINITIONS["偏暗"],
    issue_type: "偏暗"
  },
  {
    code: "blur",
    definition: ISSUE_DEFINITIONS["虚图 / 模糊"],
    issue_type: "虚图 / 模糊"
  },
  {
    code: "background_clutter",
    definition: ISSUE_DEFINITIONS["背景杂乱"],
    issue_type: "背景杂乱"
  },
  {
    code: "composition_abnormal",
    definition: ISSUE_DEFINITIONS["构图异常"],
    issue_type: "构图异常"
  }
];

export const ISSUE_TYPES = ISSUE_CATALOG.map((item) => item.issue_type);
export const ISSUE_CODES = ISSUE_CATALOG.map((item) => item.code);
export const ISSUE_BY_CODE = Object.fromEntries(ISSUE_CATALOG.map((item) => [item.code, item]));
export const ISSUE_BY_TYPE = Object.fromEntries(ISSUE_CATALOG.map((item) => [item.issue_type, item]));

function normalizeKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\/_\-\s]+/gu, "");
}

const ISSUE_ALIAS_MAP = new Map([
  ["过曝", "过曝"],
  ["曝光过度", "过曝"],
  ["exposureover", "过曝"],
  ["overexposure", "过曝"],
  ["偏暗", "偏暗"],
  ["过暗", "偏暗"],
  ["曝光不足", "偏暗"],
  ["exposureunder", "偏暗"],
  ["underexposure", "偏暗"],
  ["虚图模糊", "虚图 / 模糊"],
  ["模糊", "虚图 / 模糊"],
  ["虚焦", "虚图 / 模糊"],
  ["blur", "虚图 / 模糊"],
  ["outoffocus", "虚图 / 模糊"],
  ["背景杂乱", "背景杂乱"],
  ["背景复杂", "背景杂乱"],
  ["backgroundclutter", "背景杂乱"],
  ["构图异常", "构图异常"],
  ["构图不正", "构图异常"],
  ["构图失衡", "构图异常"],
  ["compositionabnormal", "构图异常"]
].map(([key, value]) => [normalizeKey(key), value]));

for (const item of ISSUE_CATALOG) {
  ISSUE_ALIAS_MAP.set(normalizeKey(item.code), item.issue_type);
  ISSUE_ALIAS_MAP.set(normalizeKey(item.issue_type), item.issue_type);
}

export function canonicalIssueType(value) {
  const normalized = ISSUE_ALIAS_MAP.get(normalizeKey(value));
  return normalized || null;
}

export function canonicalIssueCode(value) {
  const issueType = canonicalIssueType(value);
  return issueType ? ISSUE_BY_TYPE[issueType].code : null;
}

export function issueCodeFromType(issueType) {
  return ISSUE_BY_TYPE[issueType]?.code || null;
}

export function issueTypeFromCode(code) {
  return ISSUE_BY_CODE[code]?.issue_type || null;
}

