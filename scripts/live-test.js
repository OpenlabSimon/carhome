import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { loadProjectEnv } from "../lib/env.js";
import { buildFixturePayload } from "../lib/test-image-fixtures.js";

loadProjectEnv(resolve(new URL("..", import.meta.url).pathname));

const { runAnalysisPipeline } = await import("../lib/analyzers.js");

const requestedModes = process.argv.slice(2);
const fixtureName = process.env.TEST_FIXTURE || "overexposed";
const modes = requestedModes.length ? requestedModes : ["gemini", "hybrid"];
const payload = buildFixturePayload(fixtureName);
const outputDir = resolve(new URL("../tmp", import.meta.url).pathname);
const outputPath = resolve(outputDir, payload.imageName);

await mkdir(outputDir, { recursive: true });
await writeFile(outputPath, payload.originalBuffer);

console.log(`fixture_written | path=${outputPath}`);

let hasError = false;

for (const mode of modes) {
  try {
    const startTime = Date.now();
    const result = await runAnalysisPipeline({
      fileSize: payload.fileSize,
      height: payload.height,
      imageName: payload.imageName,
      mimeType: payload.mimeType,
      mode,
      originalBase64: payload.originalBase64,
      originalHeight: payload.originalHeight,
      originalWidth: payload.originalWidth,
      rgbaBase64: payload.rgbaBase64,
      width: payload.width
    });

    const summary = {
      analysis_time_ms: Date.now() - startTime,
      decision: result.decision,
      fallback_reason: result.runtime?.fallback_reason || null,
      fallback_used: result.runtime?.fallback_used || false,
      fixture: payload.imageName,
      gemini_summary: result.gemini?.overall_summary || null,
      has_issue: result.has_issue,
      issue_types: result.issue_types,
      mode_effective: result.runtime?.effective_mode || result.analyzer?.mode,
      mode_requested: result.runtime?.requested_mode || mode,
      model: result.gemini?.model || result.analyzer?.gemini?.model || null,
      out_of_scope_note: result.out_of_scope_note || null,
      provider: result.provider?.name || result.runtime?.provider?.name || null,
      focus_part: result.focus_part || null,
      scene: result.scene || null,
      view_angle: result.view_angle || null,
      protocol: result.gemini?.protocol || result.runtime?.gemini?.protocol || null,
      review_recommendation: result.review_recommendation,
      severity: result.severity
    };

    console.log(JSON.stringify(summary, null, 2));
  } catch (error) {
    hasError = true;
    console.log(
      JSON.stringify(
        {
          error: error instanceof Error ? error.message : "Unknown error",
          fixture: payload.imageName,
          mode_requested: mode
        },
        null,
        2
      )
    );
  }
}

if (hasError) {
  process.exitCode = 1;
}
