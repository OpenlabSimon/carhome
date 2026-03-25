# Contributing

## Setup

1. Use Node.js 18 or newer.
2. Copy `.env.example` to `.env.local` only if you want live Gemini tests.
3. Run:

```bash
npm start
```

## Before Opening A PR

Run the local checks that apply to your change:

```bash
npm run self-test
npm run self-test:runtime
```

If your change touches live Gemini behavior, also run one of:

```bash
npm run self-test:live -- gemini
npm run self-test:live -- hybrid
```

## Contribution Scope

Good contributions:

- prompt and schema improvements
- new scene / angle / focus-part taxonomy coverage
- heuristic bug fixes
- better fallback behavior
- batch tooling and evaluation improvements
- documentation for integrators

Please avoid committing:

- real API keys
- local datasets
- customer images
- large generated report files

## Pull Request Notes

Include:

- what changed
- why it changed
- how you tested it
- whether the change affects `heuristic`, `gemini`, `hybrid`, or all three
