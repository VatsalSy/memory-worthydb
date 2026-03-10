# memory-worthydb

TypeScript OpenClaw memory plugin for local-first capture, extraction, recall, and pruning. This repo should track the plugin implementation itself; local upstream clones and scratch material belong under `do-not-commit/` only.

## Intended Structure

```text
memory-worthydb/
├── index.ts                 # Plugin entry point
├── config.ts                # Config schema and defaults
├── openclaw.plugin.json     # OpenClaw manifest
├── package.json             # Package metadata
├── tsconfig.json            # TypeScript config
├── db/                      # LanceDB wrapper
├── embeddings/              # Ollama embedding client
├── extraction/              # Gemini extraction client
├── hooks/                   # Capture and recall hooks
├── tools/                   # Manual memory tools
├── prune/                   # TTL and dedup sweep logic
├── scripts/                 # Maintenance scripts
└── do-not-commit/           # Local-only upstream references
```

## Development

Expected workflow once implementation starts:

```bash
npm install
npm run build
npm test
```

Adjust commands if the repo standardizes on Bun instead of npm.

## Guidelines

- Do not commit anything under `do-not-commit/`.
- Keep the plugin installable as an OpenClaw extension without upstream OpenClaw modifications.
- Prefer plain `fetch`-based HTTP clients for Gemini and Ollama unless a stronger reason appears.
- Preserve per-agent isolation in storage and config handling.
- Keep checked-in paths portable; avoid machine-specific absolute paths.
