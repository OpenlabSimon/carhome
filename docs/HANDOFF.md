# Handoff

## Project Snapshot

`carhome` is a runnable car-image audit MVP focused on:

- 5 quality labels: `过曝 / 偏暗 / 虚图 / 模糊 / 背景杂乱 / 构图异常`
- 3 analyzer modes: `heuristic / gemini / hybrid`
- LLM-based scene understanding:
  - `整车外观`
  - `局部外观`
  - `局部内饰`
  - `车辆附件`
- LLM-based metadata extraction:
  - `拍摄角度`
  - `主要部位`

The server is a zero-dependency Node.js HTTP app. The frontend is static HTML/CSS/JS.

## What Works Now

- Local heuristic mode runs without any API key.
- `gemini` and `hybrid` modes support OpenAI-compatible Gemini proxies and official Gemini native API.
- Provider failures fall back to `heuristic`.
- Batch evaluation exists for quality labels.
- Batch scene classification exists for LLM capability testing.
- The latest scene-angle-part pipeline reached `164 / 164` identified samples on the outdoor real-photo set used in local testing.

## Main Entry Points

- Server: `server.js`
- Analyzer orchestrator: `lib/analyzers.js`
- Gemini provider: `lib/gemini-vision-provider.js`
- Provider schema normalization: `lib/vision-provider.js`
- Heuristic analyzer core: `public/js/analyzer-core.js`
- Frontend app: `public/js/app.js`

## Useful Scripts

- `npm start`
- `npm run self-test`
- `npm run self-test:runtime`
- `npm run self-test:live`
- `npm run batch-eval -- <dir> --mode heuristic|gemini|hybrid`
- `node scripts/batch-classify-scene.js <dir> --concurrency 4 --output-prefix <prefix>`

## Environment

Copy `.env.example` to `.env` or `.env.local`.

Important variables:

- `GEMINI_API_KEY`
- `GEMINI_BASE_URL`
- `GEMINI_MODEL`
- `GEMINI_PRO_MODEL`
- `GEMINI_TIMEOUT_MS`
- `GEMINI_PROTOCOL`

Do not commit `.env.local`.

## Local-Only Artifacts Not Included In Repo

These were produced during local evaluation and remain outside the repo:

- Desktop reports under `/Users/huiliu/Desktop/`
- local batch temp files under `tmp/`
- any real customer or inventory image folders

The repo is intentionally kept source-only plus docs.

## Recommended Next Steps

1. Split scene / angle / focus-part classification into a dedicated API route for easier external integration.
2. Add golden-set regression tests for the LLM metadata pipeline.
3. Export a stable public schema for:
   - `scene`
   - `view_angle`
   - `focus_part`
4. Add prompt versioning to track classification quality changes.
5. Add retry / rate-limit controls for large live batch runs.

## Known Boundaries

- Scene and part extraction rely on LLM/VLM behavior and prompt design, not classical CV.
- New automotive edge cases can require taxonomy expansion.
- Large batch live runs can still be slow because they depend on remote inference latency.
