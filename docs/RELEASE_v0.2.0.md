# carhome v0.2.0

`carhome` is now published as an open-source MVP for car-image analysis workflows.

## What is in this release

- runnable zero-dependency Node.js server
- browser UI for single-image analysis
- `heuristic / gemini / hybrid` analyzer modes
- 5-label quality audit pipeline
- LLM-based scene classification
- LLM-based angle and focus-part extraction
- batch evaluation and batch scene classification scripts
- handoff, contribution, security, and model configuration docs

## Recommended first steps

1. Run `npm start`
2. Run `npm run self-test`
3. Try `node scripts/batch-classify-scene.js <dir> --output-prefix <prefix>`
4. Add `.env.local` only if you want live Gemini tests

## Known boundaries

- LLM metadata extraction quality still depends on prompt design and provider behavior.
- Different Gemini-compatible gateways can vary in latency and structured output stability.
- This repo does not include real car-image datasets.
