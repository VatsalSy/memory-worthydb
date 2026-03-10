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
./scripts/setup-openclaw.sh
```

The setup script:

- runs `npm run build`
- links this checkout into OpenClaw with `openclaw plugins install --link <repo>`
- writes `plugins.entries.memory-worthydb`
- sets `plugins.slots.memory = "memory-worthydb"`
- creates a timestamped backup of the active OpenClaw config before it writes

The script respects `OPENCLAW_STATE_DIR` and `OPENCLAW_CONFIG_PATH`, which makes
it safe to run against isolated test profiles.

## Manual Dev Install

```bash
npm install
npm run build
openclaw plugins install --link /absolute/path/to/memory-worthydb
openclaw config set plugins.entries.memory-worthydb.config '{"extraction":{"apiKey":"${GEMINI_API_KEY}","model":"gemini-2.5-flash-lite"},"embedding":{"ollamaUrl":"http://localhost:11434","model":"qwen3-embedding:latest","dimensions":4096},"dbPath":"~/.openclaw/memory/worthydb/{agentId}","autoCapture":true,"autoRecall":true,"maxRecallResults":8,"dedup":{"threshold":0.95},"ttl":{"preference":365,"decision":180,"entity":0,"fact":90,"other":30}}' --json
```

If OpenClaw refuses to update the config because the current config is invalid,
repair it first with `openclaw doctor --fix` or `openclaw config validate`.

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

Ollama must already be running and have the `qwen3-embedding` model available
locally for semantic search and recall.

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
- Recommended verification after setup:

```bash
openclaw plugins list | grep memory-worthydb
openclaw plugins doctor
openclaw worthydb stats --agent main
./scripts/compat-check.sh
```
