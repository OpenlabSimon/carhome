import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

function parseArgs(argv) {
  const args = argv.slice(2);
  const options = {
    outputPrefix: null,
    reportPath: null
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--output-prefix") {
      options.outputPrefix = args[index + 1] || null;
      index += 1;
      continue;
    }

    if (!options.reportPath) {
      options.reportPath = arg;
    }
  }

  if (!options.reportPath || !options.outputPrefix) {
    throw new Error("Usage: node scripts/export-identification-report.js <report.json> --output-prefix <output-prefix>");
  }

  return options;
}

function toCsvValue(value) {
  const text = Array.isArray(value) ? value.join("|") : value == null ? "" : String(value);
  return `"${text.replace(/"/gu, '""')}"`;
}

function toCsv(rows, headers) {
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((header) => toCsvValue(row[header])).join(","));
  }
  return lines.join("\n");
}

function normalizeLabel(value) {
  const text = String(value || "").trim();
  return text || null;
}

function isUnknownLabel(value) {
  const label = normalizeLabel(value);
  return !label || label === "unknown";
}

function buildRows(report) {
  return (Array.isArray(report?.rows) ? report.rows : []).map((row) => {
    const unknownFields = [];

    if (isUnknownLabel(row.scene_type)) {
      unknownFields.push("scene");
    }

    if (isUnknownLabel(row.view_angle)) {
      unknownFields.push("view_angle");
    }

    if (isUnknownLabel(row.focus_part)) {
      unknownFields.push("focus_part");
    }

    let recognitionStatus = "identified";
    if (unknownFields.length === 3) {
      recognitionStatus = "unrecognized";
    } else if (unknownFields.length > 0) {
      recognitionStatus = "partial";
    }

    return {
      file_name: row.file_name,
      scene_type: normalizeLabel(row.scene_type),
      scene_type_cn: normalizeLabel(row.scene_type_cn),
      view_angle: normalizeLabel(row.view_angle),
      view_angle_cn: normalizeLabel(row.view_angle_cn),
      focus_part: normalizeLabel(row.focus_part),
      focus_part_cn: normalizeLabel(row.focus_part_cn),
      recognition_status: recognitionStatus,
      unknown_fields: unknownFields,
      decision: normalizeLabel(row.decision),
      issue_types: Array.isArray(row.issue_types) ? row.issue_types : [],
      summary: normalizeLabel(row.summary),
      out_of_scope_note: normalizeLabel(row.out_of_scope_note)
    };
  });
}

async function main() {
  const { outputPrefix, reportPath } = parseArgs(process.argv);
  const resolvedReportPath = resolve(reportPath);
  const resolvedOutputPrefix = resolve(outputPrefix);
  const report = JSON.parse(await readFile(resolvedReportPath, "utf8"));
  const rows = buildRows(report);
  const unknownRows = rows.filter((row) => row.recognition_status !== "identified");

  await mkdir(dirname(resolvedOutputPrefix), { recursive: true });

  const headers = [
    "file_name",
    "scene_type_cn",
    "view_angle_cn",
    "focus_part_cn",
    "recognition_status",
    "unknown_fields",
    "decision",
    "issue_types",
    "summary",
    "out_of_scope_note"
  ];

  const allCsvPath = `${resolvedOutputPrefix}.csv`;
  const allJsonPath = `${resolvedOutputPrefix}.json`;
  const unknownCsvPath = `${resolvedOutputPrefix}-未完全识别.csv`;
  const unknownJsonPath = `${resolvedOutputPrefix}-未完全识别.json`;

  await writeFile(allCsvPath, `${toCsv(rows, headers)}\n`);
  await writeFile(allJsonPath, `${JSON.stringify({ file_count: rows.length, rows }, null, 2)}\n`);
  await writeFile(unknownCsvPath, `${toCsv(unknownRows, headers)}\n`);
  await writeFile(unknownJsonPath, `${JSON.stringify({ file_count: unknownRows.length, rows: unknownRows }, null, 2)}\n`);

  console.log(
    JSON.stringify(
      {
        all_csv: allCsvPath,
        all_json: allJsonPath,
        identified_count: rows.filter((row) => row.recognition_status === "identified").length,
        partial_count: rows.filter((row) => row.recognition_status === "partial").length,
        total_count: rows.length,
        unrecognized_count: rows.filter((row) => row.recognition_status === "unrecognized").length,
        unknown_csv: unknownCsvPath,
        unknown_json: unknownJsonPath
      },
      null,
      2
    )
  );
}

await main();
