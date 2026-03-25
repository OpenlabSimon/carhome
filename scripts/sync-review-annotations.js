import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const MANUAL_COLUMNS = [
  "manual_confirm_labels",
  "manual_confirm_out_of_scope",
  "manual_final_decision",
  "review_notes",
  "review_status"
];

function parseArgs(argv) {
  const args = argv.slice(2);
  if (args.length < 2) {
    throw new Error("Usage: node scripts/sync-review-annotations.js <source-reviewed.csv> <target-checklist.csv> [--output output.csv]");
  }

  const options = {
    output: null,
    source: args[0],
    target: args[1]
  };

  for (let index = 2; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--output") {
      options.output = args[index + 1] || null;
      index += 1;
    }
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

  return rows;
}

function toCsvValue(value) {
  return `"${String(value ?? "").replace(/"/gu, "\"\"")}"`;
}

function toCsv(rows) {
  return rows.map((row) => row.map((value) => toCsvValue(value)).join(",")).join("\n");
}

async function main() {
  const { output, source, target } = parseArgs(process.argv);
  const sourcePath = resolve(source);
  const targetPath = resolve(target);
  const sourceRows = parseCsv(await readFile(sourcePath, "utf8"));
  const targetRows = parseCsv(await readFile(targetPath, "utf8"));

  const [sourceHeaders, ...sourceBody] = sourceRows;
  const [targetHeaders, ...targetBody] = targetRows;
  const sourceFileIndex = sourceHeaders.indexOf("file_name");
  const targetFileIndex = targetHeaders.indexOf("file_name");

  const sourceByFile = new Map(
    sourceBody.map((row) => [
      row[sourceFileIndex],
      Object.fromEntries(MANUAL_COLUMNS.map((column) => [column, row[sourceHeaders.indexOf(column)] ?? ""]))
    ])
  );

  const mergedRows = [
    targetHeaders,
    ...targetBody.map((row) => {
      const fileName = row[targetFileIndex];
      const manualValues = sourceByFile.get(fileName);
      if (!manualValues) {
        return row;
      }

      const nextRow = [...row];
      for (const column of MANUAL_COLUMNS) {
        const columnIndex = targetHeaders.indexOf(column);
        if (columnIndex >= 0) {
          nextRow[columnIndex] = manualValues[column];
        }
      }
      return nextRow;
    })
  ];

  const outputPath = resolve(output || targetPath);
  await writeFile(outputPath, `${toCsv(mergedRows)}\n`);

  console.log(
    JSON.stringify(
      {
        output_csv: outputPath,
        rows_synced: targetBody.filter((row) => sourceByFile.has(row[targetFileIndex])).length
      },
      null,
      2
    )
  );
}

await main();
