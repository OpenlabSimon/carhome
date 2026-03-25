import { ISSUE_CATALOG } from "./audit-schema.js";
import {
  VisionProviderError,
  validateFocusPartPayload,
  validateSceneClassificationPayload,
  validateVisionAuditPayload
} from "./vision-provider.js";

export const GEMINI_PROTOCOLS = ["native", "openai", "auto"];

const DEFAULT_NATIVE_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_NATIVE_MODEL = "gemini-2.5-flash";
const DEFAULT_OPENAI_MODEL = "custom/gemini-2.5-flash-preview-09-2025";
const DEFAULT_PRO_MODEL = "gemini-2.5-pro";

function getErrorDetail(error) {
  if (!(error instanceof Error)) {
    return String(error);
  }

  const parts = [];
  if (error.message) {
    parts.push(error.message);
  }

  const cause = error.cause;
  if (cause && typeof cause === "object") {
    if (typeof cause.code === "string") {
      parts.push(`code=${cause.code}`);
    }
    if (typeof cause.message === "string") {
      parts.push(`cause=${cause.message}`);
    }
  }

  return parts.join(" | ").trim();
}

export function resolveGeminiApiKey(env = process.env) {
  return (
    env.GEMINI_API_KEY ||
    env.GEMINI_OFFICIAL_API_KEY ||
    env.GOOGLE_GEMINI_API_KEY ||
    ""
  ).trim();
}

function trimTrailingSlash(value) {
  return String(value || "").replace(/\/+$/u, "");
}

function normalizeProtocol(value) {
  const normalized = String(value || "auto").trim().toLowerCase();
  return GEMINI_PROTOCOLS.includes(normalized) ? normalized : "auto";
}

function inferProtocol(baseUrl) {
  const normalizedBase = trimTrailingSlash(baseUrl);
  if (!normalizedBase || normalizedBase.includes("generativelanguage.googleapis.com") || /\/v1beta$/u.test(normalizedBase)) {
    return "native";
  }

  return "openai";
}

function ensureApiVersion(baseUrl, protocol) {
  const normalizedBase = trimTrailingSlash(baseUrl);
  if (!normalizedBase) {
    return protocol === "native" ? DEFAULT_NATIVE_BASE_URL : DEFAULT_OPENAI_BASE_URL;
  }

  if (protocol === "native") {
    return /\/v1beta$/u.test(normalizedBase) ? normalizedBase : `${normalizedBase}/v1beta`;
  }

  return /\/v1$/u.test(normalizedBase) ? normalizedBase : `${normalizedBase}/v1`;
}

function parseTimeoutMs(value, fallback = 45000) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function getGeminiRuntimeConfig(env = process.env) {
  const requestedProtocol = normalizeProtocol(env.GEMINI_PROTOCOL);
  const baseUrl = env.GEMINI_BASE_URL || env.GEMINI_API_BASE_URL || "";
  const protocol = requestedProtocol === "auto" ? inferProtocol(baseUrl) : requestedProtocol;
  const apiKey = resolveGeminiApiKey(env);

  return {
    apiBaseUrl: ensureApiVersion(baseUrl, protocol),
    configured: Boolean(apiKey),
    hasOfficialKey: Boolean((env.GEMINI_OFFICIAL_API_KEY || env.GOOGLE_GEMINI_API_KEY || "").trim()),
    hasProxyKey: Boolean((env.GEMINI_API_KEY || "").trim()),
    model: env.GEMINI_MODEL || (protocol === "native" ? DEFAULT_NATIVE_MODEL : DEFAULT_OPENAI_MODEL),
    proModel: env.GEMINI_PRO_MODEL || DEFAULT_PRO_MODEL,
    protocol,
    providerName: protocol === "native" ? "gemini-official" : "gemini-openai-compatible",
    requestedProtocol,
    timeoutMs: parseTimeoutMs(env.GEMINI_TIMEOUT_MS, protocol === "native" ? 45000 : 90000)
  };
}

function parseJsonText(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) {
    throw new VisionProviderError("Gemini returned an empty response.", {
      provider: "gemini"
    });
  }

  const withoutFence = trimmed
    .replace(/^```json\s*/iu, "")
    .replace(/^```\s*/iu, "")
    .replace(/\s*```$/iu, "")
    .trim();

  try {
    return JSON.parse(withoutFence);
  } catch {
    const match = withoutFence.match(/\{[\s\S]*\}/u);
    if (!match) {
      throw new VisionProviderError("Gemini did not return valid JSON.", {
        provider: "gemini"
      });
    }

    return JSON.parse(match[0]);
  }
}

async function readJsonResponse(response) {
  const text = await response.text();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return {
      raw_text: text
    };
  }
}

function extractNativeText(responseJson) {
  const parts = responseJson?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) {
    return "";
  }

  return parts
    .map((part) => (typeof part?.text === "string" ? part.text : ""))
    .filter(Boolean)
    .join("\n")
    .trim();
}

function extractOpenAiText(responseJson) {
  const content = responseJson?.choices?.[0]?.message?.content;

  if (typeof content === "string") {
    return content.trim();
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((part) => {
      if (typeof part === "string") {
        return part;
      }

      if (typeof part?.text === "string") {
        return part.text;
      }

      return "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

function extractErrorMessage(responseJson, fallbackMessage) {
  if (typeof responseJson?.error?.message === "string" && responseJson.error.message.trim()) {
    return responseJson.error.message.trim();
  }

  if (typeof responseJson?.message === "string" && responseJson.message.trim()) {
    return responseJson.message.trim();
  }

  if (typeof responseJson?.raw_text === "string" && responseJson.raw_text.trim()) {
    return responseJson.raw_text.trim();
  }

  return fallbackMessage;
}

function buildSceneClassificationPrompt({ metadata = {} }) {
  return `你是汽车图片场景分类器。请先判断当前图片属于以下哪一类，只允许输出严格 JSON：

- full_exterior: 主要展示整车外观，整车大部分或完整车身可见
- partial_exterior: 主要展示车身外部局部，例如轮毂、车灯、格栅、后视镜、门板、尾部局部等
- partial_interior: 主要展示车内局部，例如中控、座椅、方向盘、车门内饰、顶棚、后排、后备箱内部等
- vehicle_accessory: 主要展示车辆附件或随车物件，例如车钥匙、遥控钥匙等，不属于车身外观或车内空间本体

同时还要输出：

- view_angle: front | front_45 | side | rear_45 | rear | interior_driver | interior_center | interior_rear | detail | unknown
- focus_part: full_vehicle | front_face | rear_face | engine_bay | fuel_cap | wheel | headlight | taillight | grille | mirror | door_exterior | door_interior | pillar_trim | steering_wheel | dashboard | center_console | seat | rear_space | trunk | roof | screen | air_vent | control_panel | cup_holder | charging_port | pedal | vin_plate | key_fob | badge | window | unknown

规则：
- 只输出 JSON，不要 Markdown，不要额外解释。
- 先看主体是什么，再看取景范围；不要因为背景里有别的车或人物，就改变场景类别。
- 如果是内饰图，即使能看到窗外道路、车辆或建筑，也应归为 partial_interior。
- 如果是外观局部近景，即使只看到车的一部分，也应归为 partial_exterior。
- 如果主体是车钥匙或其他随车附件，不属于车身本体，scene 应归为 vehicle_accessory。
- 如果是整车外观图，view_angle 优先在 front / front_45 / side / rear_45 / rear 中选择。
- 如果是局部特写、近距离细节图，view_angle 优先用 detail，不要强行归入整车角度。
- 如果是驾驶位视角，view_angle 用 interior_driver；如果以中控为主，用 interior_center；如果以后排空间为主，用 interior_rear。
- 如果整张图主要在展示整车，focus_part 用 full_vehicle；如果是局部图，focus_part 选最主要展示的真实部位。
- 如果是引擎盖打开后的机舱，focus_part 用 engine_bay。
- 如果是油箱盖或加油口位置，focus_part 用 fuel_cap。
- 如果是脚踏板区域，focus_part 用 pedal。
- 如果是 A/B/C 柱或顶棚边缘局部，focus_part 用 pillar_trim。
- 如果主要展示的是车钥匙/遥控钥匙，focus_part 用 key_fob。
- 如果无法稳定判断角度或部位，输出 unknown。
- confidence 必须是 0 到 1 的数字。

元数据：
${JSON.stringify(
    {
      brand: metadata.brand || null,
      declaredColor: metadata.declaredColor || null,
      listingId: metadata.listingId || null,
      model: metadata.model || null
    },
    null,
    2
  )}

输出 JSON 结构：
{
  "scene": {
    "label": "full_exterior | partial_exterior | partial_interior | vehicle_accessory",
    "confidence": 0.92,
    "reason": "简短判断依据"
  },
  "view_angle": {
    "label": "front | front_45 | side | rear_45 | rear | interior_driver | interior_center | interior_rear | detail | unknown",
    "confidence": 0.88,
    "reason": "简短判断依据"
  },
  "focus_part": {
    "label": "full_vehicle | front_face | rear_face | engine_bay | fuel_cap | wheel | headlight | taillight | grille | mirror | door_exterior | door_interior | pillar_trim | steering_wheel | dashboard | center_console | seat | rear_space | trunk | roof | screen | air_vent | control_panel | cup_holder | charging_port | pedal | vin_plate | key_fob | badge | window | unknown",
    "confidence": 0.9,
    "reason": "简短判断依据"
  }
}`;
}

function buildFocusPartRefinementPrompt({ metadata = {}, sceneClassification = null }) {
  return `你是汽车图片局部部位分类器。请忽略画面质量，只判断这张图最主要展示的汽车部位，只允许输出严格 JSON。

可选标签：
- full_vehicle: 整车
- front_face: 前脸
- rear_face: 车尾
- engine_bay: 发动机舱/引擎盖内
- fuel_cap: 油箱盖/加油口
- wheel: 轮毂/轮胎
- headlight: 大灯
- taillight: 尾灯
- grille: 中网/格栅
- mirror: 后视镜
- door_exterior: 车门外观
- door_interior: 车门内饰
- pillar_trim: A/B/C柱或顶棚边缘
- steering_wheel: 方向盘
- dashboard: 仪表台
- center_console: 中控台
- seat: 座椅
- rear_space: 后排空间
- trunk: 后备箱
- roof: 车顶/顶棚
- screen: 屏幕
- air_vent: 出风口
- control_panel: 控制面板
- cup_holder: 杯架
- charging_port: 充电/数据接口
- pedal: 踏板区
- vin_plate: 铭牌/VIN/参数标签
- key_fob: 车钥匙/遥控钥匙
- badge: 车标/铭牌标识
- window: 车窗/玻璃
- unknown: 仍无法确定

规则：
- 只输出 JSON，不要 Markdown，不要额外解释。
- 选择画面中最主要展示的单一部位，不要返回多个标签。
- 如果是近距离特写，也必须尽量选择最接近的具体部位，不要轻易输出 unknown。
- 如果是发动机舱、油箱盖、踏板区、A柱安全气囊标、车钥匙这类细节，也要按上面的具体标签输出。
- confidence 必须是 0 到 1 的数字。

场景先验：
${JSON.stringify(
    {
      scene: sceneClassification
        ? {
            confidence: sceneClassification.confidence,
            label: sceneClassification.label,
            reason: sceneClassification.reason,
            view_angle: sceneClassification.view_angle
          }
        : null,
      brand: metadata.brand || null,
      declaredColor: metadata.declaredColor || null,
      listingId: metadata.listingId || null,
      model: metadata.model || null
    },
    null,
    2
  )}

输出 JSON 结构：
{
  "focus_part": {
    "label": "full_vehicle | front_face | rear_face | engine_bay | fuel_cap | wheel | headlight | taillight | grille | mirror | door_exterior | door_interior | pillar_trim | steering_wheel | dashboard | center_console | seat | rear_space | trunk | roof | screen | air_vent | control_panel | cup_holder | charging_port | pedal | vin_plate | key_fob | badge | window | unknown",
    "confidence": 0.9,
    "reason": "简短判断依据"
  }
}`;
}

function buildGeminiPrompt({ mode, metadata = {}, heuristicResult, sceneClassification = null }) {
  const taxonomyLines = ISSUE_CATALOG.map((item) => `- ${item.code}: ${item.issue_type}`);
  const heuristicPayload =
    mode === "hybrid" && heuristicResult
      ? JSON.stringify(
          {
            confidence: heuristicResult.confidence,
            details: heuristicResult.details.map((detail) => ({
              issue_type: detail.issue_type,
              hit: detail.hit,
              reason: detail.reason,
              score: detail.score,
              threshold: detail.threshold
            })),
            has_issue: heuristicResult.has_issue,
            issue_types: heuristicResult.issue_types,
            metrics: heuristicResult.metrics,
            severity: heuristicResult.severity
          },
          null,
          2
        )
      : "null";
  const scenePayload = sceneClassification
    ? JSON.stringify(
        {
          area: sceneClassification.area,
          confidence: sceneClassification.confidence,
          focus_part: sceneClassification.focus_part,
          label: sceneClassification.label,
          reason: sceneClassification.reason,
          scope: sceneClassification.scope,
          view_angle: sceneClassification.view_angle
        },
        null,
        2
      )
    : "null";

 return `你是汽车图片图审分析器。请审核一张汽车图片，只允许输出以下 5 个标签代码：
${taxonomyLines.join("\n")}

规则：
- 只输出严格 JSON，不要 Markdown，不要额外说明。
- issues 里只保留命中的标签，不要返回未命中的标签。
- confidence 必须是 0 到 1 的数字。
- severity 只能是 low、medium、high。
- outOfScopeNote 是可选字符串；如果能看出主要问题属于当前 5 标签之外，例如污渍、划痕、掉漆、生锈、镜头脏、非原厂涂装、拉花、强光阴影过大、闪光反射，可以在这里简短说明。
- 如果主要问题属于当前 5 标签之外，decision 输出 out_of_scope，issues 返回空数组，reviewRecommendation 输出 manual_review。
- 如果证据不足，降低 confidence，并优先输出 risk，不要轻易输出 fail。
- 如果没有明显问题，decision 输出 pass，issues 返回空数组。
- 这些图片用于展示待销售车辆，允许出现局部图、内饰图、近景图。
- 先使用给定的 scene 分类结果理解这张图是整车外观、局部外观还是局部内饰，再判断质量标签。
- 画面中可以出现人物、其他车辆、背景和局部遮挡；只有当这些因素明显干扰待售车辆展示时，才判断为 background_clutter 或 composition_abnormal。
- 不要因为是车辆局部、车内视角、近距离细节图，就直接判定 composition_abnormal。
- 如果 scene.label 是 partial_interior，不要因为看不到整车或窗外出现车辆/建筑，就判定 composition_abnormal 或 background_clutter。
- 如果 scene.label 是 partial_exterior，不要因为只拍到局部、近景或裁切特写，就判定 composition_abnormal。
- 当前只允许判断这 5 类标签；污渍、划痕、掉漆、生锈、非原厂涂装、强阴影、闪光点等不在本次标签范围内，不要强行映射到别的标签。
- 判断顺序必须是：先看过曝、偏暗、虚图/模糊，再看构图异常，最后才看背景杂乱。
- background_clutter 不是兜底标签。只要画面主要问题更像曝光、亮度、清晰度或构图，就不要输出 background_clutter。
- 如果画面里有其他车、人物、路锥、展厅元素，但主体车辆仍然清晰、居中或可正常理解，不应仅因“背景不纯净”就判为 background_clutter。
- 过曝：主体车辆的重要区域存在明显发白、细节丢失、局部高光大面积溢出。单纯存在反光点、亮色车漆、玻璃反射，不算过曝。
- 偏暗：主体车辆整体过暗，轮廓或关键细节难以辨认。夜景或室内图只要车辆主要细节仍清楚，不算偏暗。
- 虚图 / 模糊：主体车辆边缘、纹理或关键部位明显失焦、运动模糊或涂抹。背景虚化但主体清楚，不算模糊。
- 构图异常：明显倾斜、主体被错误裁切、角度怪异到影响销售展示。正常局部图、内饰图、近景细节图，不算构图异常。
- 若不确定，宁可返回 pass 或 risk 且 issues 为空，也不要把不支持的问题硬映射成 background_clutter。

元数据：
${JSON.stringify(
    {
      brand: metadata.brand || null,
      model: metadata.model || null,
      declaredColor: metadata.declaredColor || null,
      listingId: metadata.listingId || null,
      mode
    },
    null,
    2
  )}

启发式信号：
${heuristicPayload}

场景先验：
${scenePayload}

输出 JSON 结构：
{
  "decision": "pass | risk | fail | out_of_scope",
  "reviewRecommendation": "auto_pass | manual_review | auto_fail",
  "outOfScopeNote": "",
  "summary": "一句话总结",
  "issues": [
    {
      "code": "background_clutter",
      "confidence": 0.78,
      "severity": "medium",
      "reason": "简短具体原因"
    }
  ]
}`;
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new VisionProviderError(`Gemini request timed out after ${Math.round(timeoutMs / 1000)}s.`, {
        provider: "gemini",
        retryable: true,
        cause: error
      });
    }

    const causeMessage = getErrorDetail(error);
    throw new VisionProviderError(`Gemini request failed. ${causeMessage}`.trim(), {
      provider: "gemini",
      retryable: true,
      cause: error
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function callNativeApi(config, prompt, imageBase64, mimeType) {
  const url = `${config.apiBaseUrl}/models/${config.model}:generateContent`;
  const apiKey = resolveGeminiApiKey();
  const response = await fetchWithTimeout(
    url,
    {
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: prompt
              },
              {
                inlineData: {
                  data: imageBase64,
                  mimeType: mimeType || "image/jpeg"
                }
              }
            ],
            role: "user"
          }
        ],
        generationConfig: {
          responseMimeType: "application/json"
        }
      }),
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "x-goog-api-key": apiKey
      },
      method: "POST"
    },
    config.timeoutMs
  );
  const responseJson = await readJsonResponse(response);

  if (!response.ok) {
    throw new VisionProviderError(extractErrorMessage(responseJson, `Gemini request failed with status ${response.status}.`), {
      provider: config.providerName,
      retryable: response.status >= 500
    });
  }

  return {
    rawText: extractNativeText(responseJson)
  };
}

async function callOpenAiCompatibleApi(config, prompt, imageBase64, mimeType) {
  const url = `${config.apiBaseUrl}/chat/completions`;
  const apiKey = resolveGeminiApiKey();
  const response = await fetchWithTimeout(
    url,
    {
      body: JSON.stringify({
        messages: [
          {
            role: "user",
            content: [
              {
                text: prompt,
                type: "text"
              },
              {
                image_url: {
                  url: `data:${mimeType || "image/jpeg"};base64,${imageBase64}`
                },
                type: "image_url"
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
    },
    config.timeoutMs
  );
  const responseJson = await readJsonResponse(response);

  if (!response.ok) {
    throw new VisionProviderError(
      extractErrorMessage(responseJson, `Gemini proxy request failed with status ${response.status}.`),
      {
        provider: config.providerName,
        retryable: response.status >= 500
      }
    );
  }

  return {
    rawText: extractOpenAiText(responseJson)
  };
}

export class GeminiVisionProvider {
  constructor(config = getGeminiRuntimeConfig()) {
    this.config = config;
    this.name = config.providerName;
  }

  async executePrompt(prompt, imageBase64, mimeType) {
    return this.config.protocol === "native"
      ? callNativeApi(this.config, prompt, imageBase64, mimeType)
      : callOpenAiCompatibleApi(this.config, prompt, imageBase64, mimeType);
  }

  async classifyScene({ imageBase64, metadata = {}, mimeType }) {
    if (!this.config.configured) {
      throw new VisionProviderError("Gemini scene classifier requires GEMINI_API_KEY or GEMINI_OFFICIAL_API_KEY.", {
        provider: this.name
      });
    }

    if (!imageBase64) {
      throw new VisionProviderError("Gemini scene classifier requires original_base64 payload.", {
        provider: this.name
      });
    }

    const prompt = buildSceneClassificationPrompt({ metadata });
    const response = await this.executePrompt(prompt, imageBase64, mimeType);
    const scene = validateSceneClassificationPayload(parseJsonText(response.rawText));

    if (!scene) {
      throw new VisionProviderError("Gemini scene classifier did not return a valid scene label.", {
        provider: this.name
      });
    }

    const normalizedScene = {
      ...scene,
      model: this.config.model,
      protocol: this.config.protocol,
      provider: this.name,
      rawText: response.rawText
    };

    if (!normalizedScene.focus_part || normalizedScene.focus_part.label === "unknown") {
      const refinedFocusPart = await this.classifyFocusPart({
        imageBase64,
        metadata,
        mimeType,
        sceneClassification: normalizedScene
      }).catch(() => null);

      if (refinedFocusPart) {
        normalizedScene.focus_part = refinedFocusPart;
      }
    }

    return normalizedScene;
  }

  async classifyFocusPart({ imageBase64, metadata = {}, mimeType, sceneClassification = null }) {
    if (!this.config.configured) {
      throw new VisionProviderError("Gemini focus-part classifier requires GEMINI_API_KEY or GEMINI_OFFICIAL_API_KEY.", {
        provider: this.name
      });
    }

    if (!imageBase64) {
      throw new VisionProviderError("Gemini focus-part classifier requires original_base64 payload.", {
        provider: this.name
      });
    }

    const prompt = buildFocusPartRefinementPrompt({ metadata, sceneClassification });
    const response = await this.executePrompt(prompt, imageBase64, mimeType);
    const focusPart = validateFocusPartPayload(parseJsonText(response.rawText));

    if (!focusPart) {
      throw new VisionProviderError("Gemini focus-part classifier did not return a valid focus_part label.", {
        provider: this.name
      });
    }

    return focusPart;
  }

  async auditImage({ heuristicResult = null, imageBase64, metadata = {}, mimeType, mode = "gemini", sceneClassification = null }) {
    if (!this.config.configured) {
      throw new VisionProviderError("Gemini analyzer requires GEMINI_API_KEY or GEMINI_OFFICIAL_API_KEY.", {
        provider: this.name
      });
    }

    if (!imageBase64) {
      throw new VisionProviderError("Gemini analyzer requires original_base64 payload.", {
        provider: this.name
      });
    }

    const scene = sceneClassification || (await this.classifyScene({
      imageBase64,
      metadata,
      mimeType
    }));
    const prompt = buildGeminiPrompt({
      heuristicResult,
      metadata,
      mode,
      sceneClassification: scene
    });
    const response = await this.executePrompt(prompt, imageBase64, mimeType);

    return {
      ...validateVisionAuditPayload(parseJsonText(response.rawText)),
      model: this.config.model,
      protocol: this.config.protocol,
      provider: this.name,
      rawText: response.rawText,
      scene
    };
  }
}
