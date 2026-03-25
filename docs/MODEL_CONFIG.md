# Model Config

This document is for comparing model configuration options without touching source code.

## Quick Comparison

| Option | Needs Key | Protocol | Typical Use | Notes |
| --- | --- | --- | --- | --- |
| `heuristic` | No | local only | baseline / fallback / cheap screening | no remote model call |
| Gemini official Flash | Yes | `native` | general live testing | lower latency, lower cost |
| Gemini official Pro | Yes | `native` | harder samples / deeper reasoning | slower, more expensive |
| Gemini proxy Flash | Yes | `openai` | when using OpenAI-compatible Gemini gateway | easiest if team already has proxy infra |
| Gemini proxy Pro | Yes | `openai` | hard-case review on proxy infra | same behavior pattern, different model |

## Analyzer Mode vs Model

These are different concepts:

- analyzer mode:
  - `heuristic`
  - `gemini`
  - `hybrid`
- remote model:
  - `gemini-2.5-flash`
  - `gemini-2.5-pro`
  - proxy-specific model ids

Recommended defaults:

- day-to-day API default: `heuristic`
- LLM capability testing: `gemini`
- mixed production-like evaluation: `hybrid`
- first live model to try: `gemini-2.5-flash`

## Example Configs

### 1. No Remote Model

No `.env` needed.

```bash
npm start
```

Use analyzer mode `heuristic`.

### 2. Official Gemini Flash

```bash
GEMINI_API_KEY=your_official_key
GEMINI_BASE_URL=https://generativelanguage.googleapis.com/v1beta
GEMINI_MODEL=gemini-2.5-flash
GEMINI_PRO_MODEL=gemini-2.5-pro
GEMINI_PROTOCOL=native
GEMINI_TIMEOUT_MS=45000
```

### 3. Official Gemini Pro

```bash
GEMINI_API_KEY=your_official_key
GEMINI_BASE_URL=https://generativelanguage.googleapis.com/v1beta
GEMINI_MODEL=gemini-2.5-pro
GEMINI_PRO_MODEL=gemini-2.5-pro
GEMINI_PROTOCOL=native
GEMINI_TIMEOUT_MS=60000
```

### 4. OpenAI-Compatible Gemini Proxy Flash

```bash
GEMINI_API_KEY=your_proxy_key
GEMINI_BASE_URL=https://your-proxy.example.com/v1
GEMINI_MODEL=gemini-2.5-flash
GEMINI_PRO_MODEL=gemini-2.5-pro
GEMINI_PROTOCOL=openai
GEMINI_TIMEOUT_MS=90000
```

### 5. OpenAI-Compatible Gemini Proxy Pro

```bash
GEMINI_API_KEY=your_proxy_key
GEMINI_BASE_URL=https://your-proxy.example.com/v1
GEMINI_MODEL=gemini-2.5-pro
GEMINI_PRO_MODEL=gemini-2.5-pro
GEMINI_PROTOCOL=openai
GEMINI_TIMEOUT_MS=90000
```

## What To Compare

When testing different models, compare at least:

- scene accuracy
- view-angle stability
- focus-part stability
- latency on single image
- latency on batch run
- `unknown` rate
- structured JSON stability

Useful scripts:

- `npm run self-test:live -- gemini`
- `npm run self-test:live -- hybrid`
- `node scripts/batch-classify-scene.js <dir> --output-prefix <prefix>`
- `npm run batch-eval -- <dir> --mode gemini`
- `npm run batch-eval -- <dir> --mode hybrid`

## Current Recommendation

- Start with `gemini-2.5-flash`
- Compare `native` vs `openai` protocol only when infra actually differs
- Use `pro` only for hard samples or benchmark comparison
- Keep `heuristic` available even when LLM is enabled

## Safety Note

Do not commit real keys.

Use:

- `.env.local` for personal local testing
- `.env.example` for shareable templates
