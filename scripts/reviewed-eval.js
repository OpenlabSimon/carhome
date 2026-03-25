import { readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

import { ISSUE_TYPES, canonicalIssueType } from "../lib/audit-schema.js";

function parseArgs(argv) {
  const args = argv.slice(2);
  const options = {
    checklist: null,
    output: null,
    report: null
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--report") {
      options.report = args[index + 1] || null;
      index += 1;
      continue;
    }

    if (arg === "--output") {
      options.output = args[index + 1] || null;
      index += 1;
      continue;
    }

    if (!options.checklist) {
      options.checklist = arg;
    }
  }

  if (!options.checklist) {
    throw new Error("Usage: node scripts/reviewed-eval.js <review-checklist.csv> [--report batch-eval.json] [--output output.json]");
  }

  return options;
}

function parseCsv(text) {
  const rows = [];
  let current = "";
  let row = [];
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === "\"") {
      if (inQuotes && next === "\"") {
        current += "\"";
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(current);
      current = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }
      row.push(current);
      current = "";
      if (row.some((value) => value !== "")) {
        rows.push(row);
      }
      row = [];
      continue;
    }

    current += char;
  }

  if (current !== "" || row.length > 0) {
    row.push(current);
    if (row.some((value) => value !== "")) {
      rows.push(row);
    }
  }

  if (!rows.length) {
    return [];
  }

  const [headers, ...dataRows] = rows;
  return dataRows.map((values) =>
    Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]))
  );
}

function splitLabels(value) {
  return String(value || "")
    .split("|")
    .map((item) => canonicalIssueType(item))
    .filter(Boolean);
}

function asPositiveDecision(value) {
  return value === "risk" || value === "fail";
}

function safeDivide(numerator, denominator) {
  return denominator > 0 ? Number((numerator / denominator).toFixed(3)) : null;
}

function buildBinaryMetrics(rows, isPredictedPositive, isManualPositive) {
  let tp = 0;
  let fp = 0;
  let tn = 0;
  let fn = 0;

  for (const row of rows) {
    const predictedPositive = isPredictedPositive(row);
    const manualPositive = isManualPositive(row);

    if (predictedPositive && manualPositive) {
      tp += 1;
    } else if (predictedPositive) {
      fp += 1;
    } else if (manualPositive) {
      fn += 1;
    } else {
      tn += 1;
    }
  }

  const precision = safeDivide(tp, tp + fp);
  const recall = safeDivide(tp, tp + fn);
  const f1 =
    precision != null && recall != null && precision + recall > 0
      ? Number(((2 * precision * recall) / (precision + recall)).toFixed(3))
      : null;
  const accuracy = safeDivide(tp + tn, rows.length);

  return { accuracy, f1, fn, fp, precision, recall, tn, tp };
}

function buildTaxonomyScreeningMetrics(rows) {
  return buildBinaryMetrics(
    rows,
    (row) => row.model_issue_types.length > 0,
    (row) => row.manual_confirm_labels.length > 0
  );
}

function buildDecisionMetrics(rows) {
  return buildBinaryMetrics(
    rows,
    (row) => asPositiveDecision(row.model_decision),
    (row) => asPositiveDecision(row.manual_final_decision)
  );
}

function buildIssueMetrics(rows) {
  const metrics = {};

  for (const issueType of ISSUE_TYPES) {
    let tp = 0;
    let fp = 0;
    let fn = 0;
    let predictedPositive = 0;
    let manualPositive = 0;

    for (const row of rows) {
      const predicted = row.model_issue_types.includes(issueType);
      const manual = row.manual_confirm_labels.includes(issueType);

      if (predicted) {
        predictedPositive += 1;
      }
      if (manual) {
        manualPositive += 1;
      }

      if (predicted && manual) {
        tp += 1;
      } else if (predicted) {
        fp += 1;
      } else if (manual) {
        fn += 1;
      }
    }

    const precision = safeDivide(tp, tp + fp);
    const recall = safeDivide(tp, tp + fn);
    const f1 =
      precision != null && recall != null && precision + recall > 0
        ? Number(((2 * precision * recall) / (precision + recall)).toFixed(3))
        : null;

    metrics[issueType] = {
      f1,
      fn,
      fp,
      manual_positive: manualPositive,
      precision,
      predicted_positive: predictedPositive,
      recall,
      tp
    };
  }

  return metrics;
}

function buildMismatchRows(rows) {
  return rows
    .filter((row) => {
      const labelMismatch =
        row.model_issue_types.join("|") !== row.manual_confirm_labels.join("|");
      return labelMismatch || row.model_decision !== row.manual_final_decision;
    })
    .map((row) => ({
      file_name: row.file_name,
      manual_confirm_labels: row.manual_confirm_labels,
      manual_confirm_out_of_scope: row.manual_confirm_out_of_scope,
      manual_final_decision: row.manual_final_decision,
      model_decision: row.model_decision,
      model_issue_types: row.model_issue_types,
      review_notes: row.review_notes
    }));
}

function buildTaxonomyMismatchRows(rows) {
  return rows
    .filter((row) => row.model_issue_types.join("|") !== row.manual_confirm_labels.join("|"))
    .map((row) => ({
      file_name: row.file_name,
      manual_confirm_labels: row.manual_confirm_labels,
      manual_confirm_out_of_scope: row.manual_confirm_out_of_scope,
      manual_final_decision: row.manual_final_decision,
      model_decision: row.model_decision,
      model_issue_types: row.model_issue_types,
      review_notes: row.review_notes
    }));
}

function buildFilenameNoise(rows) {
  return rows
    .filter((row) => row.filename_hint_labels.length > 0)
    .map((row) => ({
      file_name: row.file_name,
      filename_hint_labels: row.filename_hint_labels,
      manual_confirm_labels: row.manual_confirm_labels,
      manual_final_decision: row.manual_final_decision
    }))
    .filter((row) => row.filename_hint_labels.join("|") !== row.manual_confirm_labels.join("|"));
}

function buildOutOfScopeFalsePositives(rows) {
  const counters = new Map();

  for (const row of rows) {
    if (row.manual_final_decision !== "out_of_scope" || row.model_issue_types.length === 0) {
      continue;
    }

    for (const issueType of row.model_issue_types) {
      counters.set(issueType, (counters.get(issueType) || 0) + 1);
    }
  }

  return Object.fromEntries([...counters.entries()].sort((left, right) => right[1] - left[1]));
}

function buildOutOfScopeHandling(rows) {
  const outOfScopeRows = rows.filter((row) => row.manual_final_decision === "out_of_scope");
  const suppressed = outOfScopeRows.filter((row) => row.model_issue_types.length === 0).length;
  const falsePositives = outOfScopeRows.filter((row) => row.model_issue_types.length > 0);

  return {
    false_positive_breakdown: buildOutOfScopeFalsePositives(rows),
    false_positive_count: falsePositives.length,
    suppression_rate: safeDivide(suppressed, outOfScopeRows.length),
    suppressed_count: suppressed,
    total: outOfScopeRows.length
  };
}

function buildExactDecisionAlignment(rows) {
  const exactMatchCount = rows.filter((row) => row.model_decision === row.manual_final_decision).length;
  return {
    exact_match_count: exactMatchCount,
    exact_match_rate: safeDivide(exactMatchCount, rows.length),
    total: rows.length
  };
}

async function main() {
  const { checklist, output, report } = parseArgs(process.argv);
  const checklistPath = resolve(checklist);
  const rawChecklist = await readFile(checklistPath, "utf8");
  const checklistRows = parseCsv(rawChecklist).map((row) => ({
    ...row,
    filename_hint_labels: splitLabels(row.filename_hint_labels),
    manual_confirm_labels: splitLabels(row.manual_confirm_labels),
    manual_confirm_out_of_scope: String(row.manual_confirm_out_of_scope || "")
      .split("|")
      .map((item) => item.trim())
      .filter(Boolean),
    model_issue_types: splitLabels(row.model_issue_types)
  }));

  const reportPath =
    report ||
    checklistPath
      .replace(/-review-checklist\.csv$/u, ".json")
      .replace(/\.csv$/u, ".json");

  const rawReport = await readFile(resolve(reportPath), "utf8");
  const parsedReport = JSON.parse(rawReport);
  const reportByFile = new Map(parsedReport.rows.map((row) => [row.file_name, row]));

  const mergedRows = checklistRows.map((row) => ({
    ...row,
    analysis_time_ms: reportByFile.get(row.file_name)?.analysis_time_ms ?? null,
    fallback_used: reportByFile.get(row.file_name)?.fallback_used ?? null,
    provider: reportByFile.get(row.file_name)?.provider ?? null
  }));

  const reviewedRows = mergedRows.filter((row) => row.review_status === "reviewed");
  const decisionMetrics = buildDecisionMetrics(reviewedRows);
  const taxonomyScreeningMetrics = buildTaxonomyScreeningMetrics(reviewedRows);
  const exactDecisionAlignment = buildExactDecisionAlignment(reviewedRows);
  const issueMetrics = buildIssueMetrics(reviewedRows);
  const mismatches = buildMismatchRows(reviewedRows);
  const taxonomyMismatches = buildTaxonomyMismatchRows(reviewedRows);
  const filenameNoise = buildFilenameNoise(reviewedRows);
  const outOfScopeFalsePositives = buildOutOfScopeFalsePositives(reviewedRows);
  const outOfScopeHandling = buildOutOfScopeHandling(reviewedRows);

  const summary = {
    checklist_csv: checklistPath,
    decision_metrics: decisionMetrics,
    exact_decision_alignment: exactDecisionAlignment,
    filename_hint_noise_count: filenameNoise.length,
    filename_hint_noise_examples: filenameNoise,
    in_scope_manual_positive_count: reviewedRows.filter((row) => row.manual_confirm_labels.length > 0).length,
    issue_metrics: issueMetrics,
    manual_decision_breakdown: {
      out_of_scope: reviewedRows.filter((row) => row.manual_final_decision === "out_of_scope").length,
      pass: reviewedRows.filter((row) => row.manual_final_decision === "pass").length,
      risk: reviewedRows.filter((row) => row.manual_final_decision === "risk").length
    },
    mismatch_count: mismatches.length,
    mismatches,
    model_mode: parsedReport.mode,
    out_of_scope_false_positive_breakdown: outOfScopeFalsePositives,
    out_of_scope_handling: outOfScopeHandling,
    report_json: resolve(reportPath),
    taxonomy_mismatch_count: taxonomyMismatches.length,
    taxonomy_mismatches: taxonomyMismatches,
    taxonomy_screening_metrics: taxonomyScreeningMetrics,
    reviewed_count: reviewedRows.length
  };

  const outputPath = output
    ? resolve(output)
    : join(resolve(new URL("../tmp/reports", import.meta.url).pathname), `${basename(checklistPath, ".csv")}-gold-eval.json`);

  await writeFile(outputPath, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify(summary, null, 2));
}

await main();
