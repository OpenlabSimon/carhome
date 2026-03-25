import { resolve } from "node:path";

import { loadProjectEnv } from "../lib/env.js";
import { buildFixturePayload } from "../lib/test-image-fixtures.js";

loadProjectEnv(resolve(new URL("..", import.meta.url).pathname));

const { runAnalysisPipeline } = await import("../lib/analyzers.js");

function applyEnv(overrides) {
  const previous = new Map();

  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, process.env[key]);

    if (value === null) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  return () => {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  };
}

async function runCase(name, overrides, mode, expectedAttemptedMode, fixtureName) {
  const restore = applyEnv(overrides);
  const payload = buildFixturePayload(fixtureName);

  try {
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

    if (result.runtime?.effective_mode !== "heuristic") {
      throw new Error(`${name}: expected effective_mode=heuristic, got ${result.runtime?.effective_mode}`);
    }

    if (!result.runtime?.fallback_used) {
      throw new Error(`${name}: expected fallback_used=true`);
    }

    if (result.runtime?.attempted_mode !== expectedAttemptedMode) {
      throw new Error(`${name}: expected attempted_mode=${expectedAttemptedMode}, got ${result.runtime?.attempted_mode}`);
    }

    console.log(
      JSON.stringify(
        {
          attempted_mode: result.runtime?.attempted_mode,
          case: name,
          decision: result.decision,
          effective_mode: result.runtime?.effective_mode,
          fallback_reason: result.runtime?.fallback_reason,
          issue_types: result.issue_types
        },
        null,
        2
      )
    );
  } finally {
    restore();
  }
}

await runCase(
  "missing-key-fallback",
  {
    GEMINI_API_KEY: null,
    GEMINI_BASE_URL: null,
    GEMINI_MODEL: null,
    GEMINI_PROTOCOL: null
  },
  "gemini",
  "heuristic",
  "overexposed"
);

await runCase(
  "provider-error-fallback",
  {
    GEMINI_API_KEY: "dummy-key",
    GEMINI_BASE_URL: "http://127.0.0.1:9",
    GEMINI_MODEL: "gemini-2.5-flash",
    GEMINI_PROTOCOL: "openai"
  },
  "hybrid",
  "hybrid",
  "cluttered"
);

const outOfScopePayload = buildFixturePayload("normal");
const outOfScopeResult = await runAnalysisPipeline({
  fileSize: outOfScopePayload.fileSize,
  height: outOfScopePayload.height,
  imageName: "非原厂涂装:拉花.png",
  mimeType: outOfScopePayload.mimeType,
  mode: "heuristic",
  originalBase64: outOfScopePayload.originalBase64,
  originalHeight: outOfScopePayload.originalHeight,
  originalWidth: outOfScopePayload.originalWidth,
  rgbaBase64: outOfScopePayload.rgbaBase64,
  width: outOfScopePayload.width
});

if (outOfScopeResult.decision !== "out_of_scope") {
  throw new Error(`out-of-scope-decision: expected decision=out_of_scope, got ${outOfScopeResult.decision}`);
}

if (outOfScopeResult.review_recommendation !== "manual_review") {
  throw new Error(
    `out-of-scope-decision: expected review_recommendation=manual_review, got ${outOfScopeResult.review_recommendation}`
  );
}

if (!String(outOfScopeResult.out_of_scope_note || "").includes("非原厂涂装")) {
  throw new Error("out-of-scope-decision: expected out_of_scope_note to mention 非原厂涂装");
}

console.log(
  JSON.stringify(
    {
      case: "out-of-scope-decision",
      decision: outOfScopeResult.decision,
      issue_types: outOfScopeResult.issue_types,
      out_of_scope_note: outOfScopeResult.out_of_scope_note,
      review_recommendation: outOfScopeResult.review_recommendation
    },
    null,
    2
  )
);
