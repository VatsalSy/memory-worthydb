# memory-worthydb

Local-first long-term memory plugin for OpenClaw.

## What It Does

`memory-worthydb` is a third-party `kind: "memory"` plugin for OpenClaw that combines:

- Automatic post-turn capture through `agent_end`
- Automatic pre-turn recall through `before_prompt_build`
- Provider-neutral extraction with `gemini`, `openai`, or `together` as primary or fallback
- Gemini direct HTTP extraction plus OpenAI-compatible chat completions for OpenAI and Together
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
- The API key(s) for whichever extraction providers you plan to use, available either in your shell environment or in `~/.openclaw/.env`

Recommended prerequisite checks:

```bash
node --version
openclaw --version
ollama pull qwen3-embedding:latest
curl -fsS http://localhost:11434/api/tags | grep qwen3-embedding
printf 'GEMINI_API_KEY=%s\n' "$GEMINI_API_KEY"
```

If you keep secrets in `~/.openclaw/.env`, the plugin and compat check script can read `GEMINI_API_KEY` from there.

## Getting API Keys

This plugin uses these environment variables:

- `GEMINI_API_KEY`
- `OPENAI_API_KEY`
- `TOGETHER_API_KEY`

### 1. Gemini

Recommended for this plugin: use a Gemini API key that works with the Gemini Developer API and the `generativelanguage.googleapis.com` endpoint.

Official docs:

- Google AI Studio / Gemini API keys: <https://ai.google.dev/gemini-api/docs/api-key>
- Google Cloud / Vertex AI API keys: <https://docs.cloud.google.com/vertex-ai/generative-ai/docs/start/api-keys>

The simplest path is Google AI Studio:

1. Open <https://aistudio.google.com/app/apikey>
2. If needed, create a project or import an existing Google Cloud project into Google AI Studio
3. Create or copy a Gemini API key
4. Put it in `~/.openclaw/.env` as:

```bash
GEMINI_API_KEY=your_key_here
```

If you originally created the key through Google Cloud and do not remember how:

- Google AI Studio can import Google Cloud projects and show Gemini-compatible keys for those projects
- only keys with no restrictions, or keys restricted to the Generative Language API, are shown there
- for this plugin, that is usually the easiest way to recover or recreate the key

Important note:

- this plugin currently uses the Gemini Developer API-style endpoint (`https://generativelanguage.googleapis.com/v1beta/...`)
- it does **not** currently implement the full Vertex AI OAuth / Application Default Credentials flow
- so if you are using Vertex AI in Google Cloud, prefer a plain API key compatible with the Gemini API for this plugin

### 2. OpenAI

Official docs:

- OpenAI API key setup: <https://platform.openai.com/docs/quickstart#step-2-set-up-your-api-key>
- OpenAI authentication reference: <https://platform.openai.com/docs/api-reference/authentication>

Steps:

1. Open your OpenAI Platform API key settings
2. Create a new secret key
3. Store it in `~/.openclaw/.env`:

```bash
OPENAI_API_KEY=your_key_here
```

### 3. Together AI

Official docs:

- Together authentication and API keys: <https://docs.together.ai/reference/authentication>

Steps:

1. Open <https://api.together.ai/>
2. Go to `Settings`
3. Open `API Keys`
4. Copy or create a key
5. Store it in `~/.openclaw/.env`:

```bash
TOGETHER_API_KEY=your_key_here
```

## Install From Source

```bash
npm install
./scripts/setup-openclaw.sh
```

The setup script is interactive. It prompts for a primary extractor provider/model,
an optional fallback extractor provider/model, Ollama URL/model, database path
template, recall limits, dedup threshold, and TTL values. Press `Enter` at each
prompt to accept the recommended defaults.

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

OpenClaw still exposes the legacy `before_agent_start` hook, but new prompt-context
injection work should use `before_prompt_build`. This plugin now uses only the modern
hook at runtime, while keeping regression coverage for the legacy path in tests.

## Manual Install

```bash
npm install
npm run build
openclaw plugins install --link /absolute/path/to/memory-worthydb
openclaw config set plugins.entries.memory-worthydb.enabled true --json
openclaw config set plugins.slots.memory '"memory-worthydb"' --json
openclaw config set plugins.entries.memory-worthydb.config '{"extraction":{"maxFacts":5,"primary":{"provider":"gemini","apiKey":"${GEMINI_API_KEY}","model":"gemini-2.5-flash-lite","baseUrl":"https://generativelanguage.googleapis.com/v1beta","timeoutMs":8000}},"embedding":{"ollamaUrl":"http://localhost:11434","model":"qwen3-embedding:latest","dimensions":4096,"keepAlive":"1h"},"dbPath":"~/.openclaw/memory/worthydb/{agentId}","autoCapture":true,"autoRecall":true,"maxRecallResults":8,"recallMinScore":0.45,"dedup":{"threshold":0.95},"ttl":{"preference":365,"decision":180,"entity":0,"fact":90,"other":30}}' --json
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
            "maxFacts": 5,
            "primary": {
              "provider": "gemini",
              "apiKey": "${GEMINI_API_KEY}",
              "model": "gemini-2.5-flash-lite",
              "baseUrl": "https://generativelanguage.googleapis.com/v1beta",
              "timeoutMs": 8000
            },
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
          "recallMinScore": 0.45,
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

If Gemini is unavailable or `GEMINI_API_KEY` is missing, extraction can fall back to
an OpenAI, Gemini, or Together model when `extraction.fallback` is configured. If no fallback
is configured, automatic extraction after turns is skipped, but the plugin can still
load and manual/semantic recall can still work as long as Ollama is available.

## Recommended Models

Recommended provider/model pairs for this plugin:

- `gemini`: `gemini-2.5-flash-lite`
- `openai`: `gpt-4o-mini`
- `together`: `meta-llama/Llama-3.3-70B-Instruct-Turbo`

Why these:

- `gemini-2.5-flash-lite` is the current fast, cheap default already used successfully in this plugin.
- `gpt-4o-mini` is a better fit than a GPT-5 small model for terse JSON extraction because it is cheaper and already validated against this plugin's prompt/response pattern.
- `meta-llama/Llama-3.3-70B-Instruct-Turbo` behaved better than reasoning-style Together models for short extraction tasks.

Avoid Together reasoning-style models such as `openai/gpt-oss-20b` for this use case. In testing, they can spend the token budget on reasoning and leave the final `message.content` empty.

## Acknowledgments

Thanks to the [OpenClaw LanceDB memory plugin](https://github.com/openclaw/openclaw/tree/main/extensions/memory-lancedb) and the [OpenClaw Supermemory plugin](https://github.com/supermemoryai/openclaw-supermemory) for inspiration.

## Configuration Reference

All config keys currently supported by the schema are listed below.

| Key | Default | Purpose |
| --- | --- | --- |
| `extraction.maxFacts` | `5` | Maximum number of memories extracted from a single turn. |
| `extraction.primary.provider` | `gemini` | Primary extractor provider. Supported values: `gemini`, `openai`, `together`. |
| `extraction.primary.apiKey` | provider env | Primary provider API key. When omitted, the plugin checks `GEMINI_API_KEY`, `OPENAI_API_KEY`, or `TOGETHER_API_KEY` based on provider. |
| `extraction.primary.model` | `gemini-2.5-flash-lite` | Primary extractor model id. |
| `extraction.primary.baseUrl` | provider default | Primary API base URL. |
| `extraction.primary.timeoutMs` | `8000` | Timeout for primary extraction requests in milliseconds. |
| `extraction.fallback.provider` | `openai` | Fallback extractor provider. Supported values: `gemini`, `openai`, `together`. |
| `extraction.fallback.apiKey` | empty string | Optional fallback API key. No environment fallback is applied unless you explicitly pass a value or placeholder such as `${OPENAI_API_KEY}`. |
| `extraction.fallback.model` | `gpt-4o-mini` | Fallback model id. Leave blank to disable fallback extraction. |
| `extraction.fallback.baseUrl` | provider default | Fallback API base URL, defaulting to the selected provider's standard endpoint. |
| `extraction.fallback.timeoutMs` | `8000` | Timeout for fallback extraction requests in milliseconds. |
| `embedding.ollamaUrl` | `http://localhost:11434` | Base URL for the local Ollama server. |
| `embedding.model` | `qwen3-embedding:latest` | Ollama model used to embed stored memories and search queries. |
| `embedding.dimensions` | `4096` | Expected vector dimension for the selected embedding model. |
| `embedding.timeoutMs` | `5000` | Timeout for Ollama embedding requests in milliseconds. |
| `embedding.keepAlive` | unset (`ollama` request default `1h`) | Optional Ollama keep-alive duration passed through to embedding requests. |
| `dbPath` | `~/.openclaw/memory/worthydb/{agentId}` | LanceDB path template. Keep `{agentId}` to preserve per-agent isolation. |
| `autoCapture` | `true` | Enables automatic extraction and storage after successful agent turns. |
| `autoRecall` | `true` | Enables automatic recall injection before agent turns. |
| `maxRecallResults` | `8` | Maximum number of recalled memories returned or injected. |
| `recallMinScore` | `0.45` | Minimum cosine similarity required before a memory is injected into context. |
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
- The extraction prompt intentionally rejects ephemeral session-state facts such as time-of-day, temporary mood, or assistant persona drift.
- The runtime still accepts the legacy `extraction.apiKey` / `extraction.model` / `extraction.timeoutMs` Gemini shape while migrating to the new provider-neutral config.
- If Ollama or any extraction provider is unavailable, the agent still runs; memory capture/recall degrades gracefully.
- `scripts/compat-check.sh` is intended as a quick post-update smoke check after `openclaw update`.
- The setup script writes backups before config changes and is safe to test with `OPENCLAW_STATE_DIR` and `OPENCLAW_CONFIG_PATH`.
- Recommended verification after setup:

```bash
openclaw plugins list | grep memory-worthydb
openclaw plugins doctor
openclaw worthydb stats --agent main
./scripts/compat-check.sh
```
