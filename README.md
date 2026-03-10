# memory-worthydb

Local-first long-term memory plugin for OpenClaw.

## What It Does

`memory-worthydb` is a third-party `kind: "memory"` plugin for OpenClaw that combines:

- Automatic post-turn capture through `agent_end`
- Automatic pre-turn recall through `before_agent_start`
- Gemini 2.5 Flash Lite extraction over direct HTTP
- Ollama `qwen3-embedding` local embeddings
- LanceDB local vector storage
- Per-agent database isolation through `dbPath` templates
- Duplicate rejection on write and TTL/dedup pruning

## Install

```bash
npm install
npm run build
npm test
```

Then place or symlink this repo under `~/.openclaw/extensions/memory-worthydb/` and select it as the active memory plugin in `openclaw.json`.

## Example OpenClaw Config

```json
{
  "plugins": {
    "slots": {
      "memory": "memory-worthydb"
    },
    "entries": {
      "memory-worthydb": {
        "enabled": true,
        "config": {
          "extraction": {
            "apiKey": "${GEMINI_API_KEY}",
            "model": "gemini-2.5-flash-lite"
          },
          "embedding": {
            "ollamaUrl": "http://localhost:11434",
            "model": "qwen3-embedding:latest",
            "dimensions": 4096
          },
          "dbPath": "~/.openclaw/memory/worthydb/{agentId}",
          "autoCapture": true,
          "autoRecall": true,
          "maxRecallResults": 8,
          "dedup": {
            "threshold": 0.95
          },
          "ttl": {
            "preference": 365,
            "decision": 180,
            "entity": 0,
            "fact": 90,
            "other": 30
          }
        }
      }
    }
  }
}
```

`GEMINI_API_KEY` can come from process env or `~/.openclaw/.env`.

## Manual Commands

```bash
openclaw worthydb list --agent main
openclaw worthydb search "what does Vatsal prefer?" --agent main
openclaw worthydb forget <memory-id> --agent main
openclaw worthydb prune --agent main --dry-run
openclaw worthydb stats --agent main
```

## Notes

- The plugin never requires upstream OpenClaw modifications.
- If Ollama or Gemini are unavailable, the agent still runs; memory capture/recall degrades gracefully.
- `scripts/compat-check.sh` is intended as a quick post-update smoke check after `openclaw update`.
