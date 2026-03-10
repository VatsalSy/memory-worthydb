# memory-worthydb

Local-first long-term memory plugin for OpenClaw.

## Overview

`memory-worthydb` is intended to be a drop-in memory plugin that combines passive capture, LLM-based fact extraction, local vector storage, and per-agent isolation without requiring upstream OpenClaw changes. The planned implementation uses Gemini 2.5 Flash Lite for extraction, Ollama `qwen3-embedding` for embeddings, and LanceDB for storage.

## Planned Architecture

- OpenClaw extension plugin with `index.ts` entrypoint and `openclaw.plugin.json` manifest
- Passive capture and recall hooks under `hooks/`
- LanceDB-backed store under `db/`
- Plain HTTP clients for Gemini extraction and Ollama embeddings
- Manual memory tools plus scheduled prune logic
- Workspace-local `do-not-commit/` references for upstream clones and scratch work

## Expected Layout

```text
memory-worthydb/
├── index.ts
├── config.ts
├── openclaw.plugin.json
├── package.json
├── tsconfig.json
├── db/
├── embeddings/
├── extraction/
├── hooks/
├── tools/
├── prune/
├── scripts/
└── do-not-commit/
```

## Development Notes

The repository is still in pre-build stage. Keep local reference checkouts and experiments under `do-not-commit/`, and keep tracked files focused on the actual plugin implementation and repo documentation.

## License

No license has been added yet.
