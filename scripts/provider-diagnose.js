import { resolve } from "node:path";

import { loadProjectEnv } from "../lib/env.js";
import { getGeminiRuntimeConfig, resolveGeminiApiKey } from "../lib/gemini-vision-provider.js";

loadProjectEnv(resolve(new URL("..", import.meta.url).pathname));

async function readResponseText(response) {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

function serializeError(error) {
  if (!(error instanceof Error)) {
    return {
      error: String(error)
    };
  }

  return {
    cause_code: error.cause && typeof error.cause === "object" ? error.cause.code || null : null,
    cause_message: error.cause && typeof error.cause === "object" ? error.cause.message || null : null,
    error: error.message
  };
}

async function diagnoseNative(config, apiKey) {
  const response = await fetch(`${config.apiBaseUrl}/models/${config.model}`, {
    headers: {
      "x-goog-api-key": apiKey
    }
  });
  const body = await readResponseText(response);

  return {
    body_preview: body.slice(0, 400),
    ok: response.ok,
    status: response.status
  };
}

async function diagnoseOpenAi(config, apiKey) {
  const response = await fetch(`${config.apiBaseUrl}/chat/completions`, {
    body: JSON.stringify({
      messages: [
        {
          role: "user",
          content: [
            {
              text: "Return JSON only: {\"ok\":true}",
              type: "text"
            }
          ]
        }
      ],
      model: config.model,
      response_format: {
        type: "json_object"
      }
    }),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json; charset=utf-8"
    },
    method: "POST"
  });
  const body = await readResponseText(response);

  return {
    body_preview: body.slice(0, 400),
    ok: response.ok,
    status: response.status
  };
}

const config = getGeminiRuntimeConfig();
const apiKey = resolveGeminiApiKey();

const summary = {
  api_base_url: config.apiBaseUrl,
  configured: config.configured,
  has_official_key: config.hasOfficialKey,
  has_proxy_key: config.hasProxyKey,
  model: config.model,
  protocol: config.protocol,
  provider_name: config.providerName,
  requested_protocol: config.requestedProtocol
};

console.log(JSON.stringify(summary, null, 2));

if (!apiKey) {
  throw new Error("No Gemini key found in GEMINI_API_KEY, GEMINI_OFFICIAL_API_KEY, or GOOGLE_GEMINI_API_KEY.");
}

try {
  const result = config.protocol === "native"
    ? await diagnoseNative(config, apiKey)
    : await diagnoseOpenAi(config, apiKey);

  console.log(JSON.stringify(result, null, 2));

  if (!result.ok) {
    process.exitCode = 1;
  }
} catch (error) {
  console.log(
    JSON.stringify(
      {
        ...serializeError(error),
        protocol: config.protocol
      },
      null,
      2
    )
  );
  process.exitCode = 1;
}
