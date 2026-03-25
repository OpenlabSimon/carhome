import { readdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

function parseArgs(argv) {
  const args = argv.slice(2);
  const options = {
    output: null,
    report: null
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--output") {
      options.output = args[index + 1] || null;
      index += 1;
      continue;
    }

    if (!options.report) {
      options.report = arg;
    }
  }

  return options;
}

async function findLatestBatchReport(reportDir) {
  const entries = await readdir(reportDir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && /^batch-eval-.*\.json$/u.test(entry.name))
    .map((entry) => entry.name)
    .sort();

  if (!files.length) {
    throw new Error(`No batch-eval JSON reports found in ${reportDir}`);
  }

  return join(reportDir, files.at(-1));
}

function buildMismatchType(row) {
  if (row.error_message) {
    return "model_error";
  }

  if (row.expected_mvp_labels.length > 0) {
    return row.all_expected_hit ? "in_scope_match" : "in_scope_mismatch";
  }

  if (row.unsupported_hints.length > 0 && row.issue_types.length > 0) {
    return "out_of_scope_false_positive";
  }

  if (row.unsupported_hints.length > 0) {
    return "out_of_scope_expected";
  }

  return row.issue_types.length > 0 ? "no_hint_but_flagged" : "no_hint_pass";
}

function buildReviewPriority(row) {
  const mismatchType = buildMismatchType(row);
  if (mismatchType === "model_error") {
    return "critical";
  }

  if (mismatchType === "in_scope_mismatch" || mismatchType === "out_of_scope_false_positive") {
    return "high";
  }

  if (row.decision === "risk" || row.decision === "fail") {
    return "medium";
  }

  return "low";
}

function toCsvValue(value) {
  const text = Array.isArray(value) ? value.join("|") : value == null ? "" : String(value);
  return `"${text.replace(/"/gu, "\"\"")}"`;
}

function toCsv(rows) {
  const headers = [
    "file_name",
    "image_path",
    "review_priority",
    "mismatch_type",
    "model_decision",
    "model_issue_types",
    "model_summary",
    "model_out_of_scope_note",
    "filename_hint_labels",
    "filename_hint_out_of_scope",
    "manual_confirm_labels",
    "manual_confirm_out_of_scope",
    "manual_final_decision",
    "review_status",
    "review_notes"
  ];

  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((header) => toCsvValue(row[header])).join(","));
  }
  return lines.join("\n");
}

async function main() {
  const reportDir = resolve(new URL("../tmp/reports", import.meta.url).pathname);
  const { output, report } = parseArgs(process.argv);
  const reportPath = report ? resolve(report) : await findLatestBatchReport(reportDir);
  const raw = await readFile(reportPath, "utf8");
  const parsed = JSON.parse(raw);
  const imageDir = parsed.directory;
  const reportBaseName = basename(reportPath, ".json");

  const rows = parsed.rows.map((row) => ({
    file_name: row.file_name,
    image_path: join(imageDir, row.file_name),
    review_priority: buildReviewPriority(row),
    mismatch_type: buildMismatchType(row),
    model_decision: row.decision,
    model_issue_types: row.issue_types,
    model_out_of_scope_note: row.out_of_scope_note || "",
    model_summary: row.summary || "",
    filename_hint_labels: row.expected_mvp_labels,
    filename_hint_out_of_scope: row.unsupported_hints,
    manual_confirm_labels: "",
    manual_confirm_out_of_scope: "",
    manual_final_decision: "",
    review_status: "pending",
    review_notes: ""
  }));

  const outputPath = output
    ? resolve(output)
    : join(reportDir, `${reportBaseName}-review-checklist.csv`);

  await writeFile(outputPath, `${toCsv(rows)}\n`);

  const summary = {
    checklist_csv: outputPath,
    high_priority: rows.filter((row) => row.review_priority === "high").length,
    low_priority: rows.filter((row) => row.review_priority === "low").length,
    medium_priority: rows.filter((row) => row.review_priority === "medium").length,
    total: rows.length
  };

  console.log(JSON.stringify(summary, null, 2));
}

await main();
