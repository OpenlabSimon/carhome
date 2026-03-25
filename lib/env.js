import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const ENV_FILE_NAMES = [".env.local", ".env"];

function stripWrappingQuotes(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function parseEnvLine(line) {
  const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
  if (!match) {
    return null;
  }

  const [, key, rawValue] = match;
  return {
    key,
    value: stripWrappingQuotes(rawValue.trim())
  };
}

export function loadProjectEnv(projectRoot = process.cwd()) {
  for (const fileName of ENV_FILE_NAMES) {
    const filePath = resolve(projectRoot, fileName);
    if (!existsSync(filePath)) {
      continue;
    }

    const content = readFileSync(filePath, "utf8");
    for (const line of content.split(/\r?\n/u)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }

      const parsed = parseEnvLine(trimmed);
      if (!parsed || parsed.key in process.env) {
        continue;
      }

      process.env[parsed.key] = parsed.value;
    }
  }
}
