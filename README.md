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

## Prerequisites

Before installing from source, make sure all of the following are already available:

- Node.js `>=20.11.0`
- OpenClaw `>=2026.3.8`
- `openclaw`, `node`, `npm`, and `curl` on `PATH`
- Ollama running locally at `http://localhost:11434` or another reachable URL
- The `qwen3-embedding` model pulled into Ollama
- A Gemini API key available either in your shell environment or in `~/.openclaw/.env`

Recommended prerequisite checks:

```bash
node --version
openclaw --version
ollama pull qwen3-embedding:latest
curl -fsS http://localhost:11434/api/tags | grep qwen3-embedding
printf 'GEMINI_API_KEY=%s\n' "$GEMINI_API_KEY"
```

If you keep secrets in `~/.openclaw/.env`, the plugin and compat check script can read `GEMINI_API_KEY` from there.

## Install From Source

```bash
npm install
./scripts/setup-openclaw.sh
```

The setup script is interactive. It prompts for the Gemini model, Ollama URL/model,
database path template, recall limits, dedup threshold, and TTL values. Press `Enter`
at each prompt to accept the recommended defaults.

The setup script:

- runs `npm run build` from this checkout
- links this checkout into OpenClaw with `openclaw plugins install --link <repo>`
- writes `plugins.entries.memory-worthydb`
- sets `plugins.slots.memory = "memory-worthydb"`
- disables other memory-slot plugins when OpenClaw switches the exclusive slot
- creates a timestamped backup of the active OpenClaw config before it writes
- warns if `GEMINI_API_KEY` is still unset after writing the config

The script respects `OPENCLAW_STATE_DIR` and `OPENCLAW_CONFIG_PATH`, which makes
it safe to run against isolated test profiles.

`npm run build` currently performs a TypeScript typecheck for the plugin entrypoint.

After install, restart the OpenClaw gateway or daemon process so the linked plugin
and updated config are reloaded.

## Manual Install

```bash
npm install
npm run build
openclaw plugins install --link /absolute/path/to/memory-worthydb
openclaw config set plugins.entries.memory-worthydb.enabled true --json
openclaw config set plugins.slots.memory '"memory-worthydb"' --json
openclaw config set plugins.entries.memory-worthydb.config '{"extraction":{"apiKey":"${GEMINI_API_KEY}","model":"gemini-2.5-flash-lite"},"embedding":{"ollamaUrl":"http://localhost:11434","model":"qwen3-embedding:latest","dimensions":4096},"dbPath":"~/.openclaw/memory/worthydb/{agentId}","autoCapture":true,"autoRecall":true,"maxRecallResults":8,"dedup":{"threshold":0.95},"ttl":{"preference":365,"decision":180,"entity":0,"fact":90,"other":30}}' --json
```

If OpenClaw refuses to update the config because the current config is invalid,
repair it first with `openclaw doctor --fix` or `openclaw config validate`.

The manual command above sets only the common keys. Omitted advanced keys fall back
to the defaults shown in the configuration reference below.

## What Gets Written To OpenClaw

After a successful setup run, OpenClaw should contain:

- `plugins.load.paths` with the local checkout path
- `plugins.entries.memory-worthydb.enabled = true`
- `plugins.entries.memory-worthydb.config = {...}`
- `plugins.slots.memory = "memory-worthydb"`

This is a linked local install. The plugin runs from the checked-out repository path
rather than from a separately copied bundle.

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
            "model": "gemini-2.5-flash-lite",
            "maxFacts": 5,
            "timeoutMs": 8000
          },
          "embedding": {
            "ollamaUrl": "http://localhost:11434",
            "model": "qwen3-embedding:latest",
            "dimensions": 4096,
            "timeoutMs": 5000
          },
          "dbPath": "~/.openclaw/memory/worthydb/{agentId}",
          "autoCapture": true,
          "autoRecall": true,
          "maxRecallResults": 8,
          "capture": {
            "skipCron": true,
            "skipNoReply": true,
            "minTurnChars": 20,
            "maxTurnChars": 8000
          },
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

If Gemini is unavailable or `GEMINI_API_KEY` is missing, automatic extraction after
turns is skipped, but the plugin can still load and manual/semantic recall can still
work as long as Ollama is available.

## Configuration Reference

All config keys currently supported by the schema are listed below.

| Key | Default | Purpose |
| --- | --- | --- |
| `extraction.apiKey` | `""` | Gemini API key or `${GEMINI_API_KEY}` placeholder used for post-turn extraction. |
| `extraction.model` | `gemini-2.5-flash-lite` | Gemini model used to extract durable memory facts. |
| `extraction.maxFacts` | `5` | Maximum number of memories extracted from a single turn. |
| `extraction.timeoutMs` | `8000` | Timeout for Gemini extraction requests in milliseconds. |
| `embedding.ollamaUrl` | `http://localhost:11434` | Base URL for the local Ollama server. |
| `embedding.model` | `qwen3-embedding:latest` | Ollama model used to embed stored memories and search queries. |
| `embedding.dimensions` | `4096` | Expected vector dimension for the selected embedding model. |
| `embedding.timeoutMs` | `5000` | Timeout for Ollama embedding requests in milliseconds. |
| `dbPath` | `~/.openclaw/memory/worthydb/{agentId}` | LanceDB path template. Keep `{agentId}` to preserve per-agent isolation. |
| `autoCapture` | `true` | Enables automatic extraction and storage after successful agent turns. |
| `autoRecall` | `true` | Enables automatic recall injection before agent turns. |
| `maxRecallResults` | `8` | Maximum number of recalled memories returned or injected. |
| `capture.skipCron` | `true` | Skips capture for cron, isolated, or non-chat sessions. |
| `capture.skipNoReply` | `true` | Skips sentinel outputs such as `NO_REPLY` and `HEARTBEAT_OK`. |
| `capture.minTurnChars` | `20` | Minimum combined user and assistant text length eligible for extraction. |
| `capture.maxTurnChars` | `8000` | Maximum combined turn length forwarded to extraction. |
| `dedup.threshold` | `0.95` | Duplicate-rejection cosine similarity threshold used on writes. |
| `ttl.preference` | `365` | Expiry window in days for preference memories. `0` disables expiry. |
| `ttl.decision` | `180` | Expiry window in days for decision memories. |
| `ttl.entity` | `0` | Expiry window in days for entity memories. `0` disables expiry. |
| `ttl.fact` | `90` | Expiry window in days for factual memories. |
| `ttl.other` | `30` | Expiry window in days for uncategorized or miscellaneous memories. |

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
- The setup script writes backups before config changes and is safe to test with `OPENCLAW_STATE_DIR` and `OPENCLAW_CONFIG_PATH`.
- Recommended verification after setup:

```bash
openclaw plugins list | grep memory-worthydb
openclaw plugins doctor
openclaw worthydb stats --agent main
./scripts/compat-check.sh
```
