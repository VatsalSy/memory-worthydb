# WorthyDB — Development Plan

## 1. Multimodal embedding support via Gemini embedding-2-preview

**Context:**
OpenClaw v2026.3.11 added first-class support for `gemini-embedding-2-preview` with configurable output dimensions and automatic reindexing when dimensions change. This is a cloud embedding backend that could replace or supplement the local Ollama/qwen3-embedding setup.

**Goal:**
Add a Gemini embedding provider to WorthyDB as an alternative to the current Ollama backend.

**Why:**
- `gemini-embedding-2-preview` is a high-quality multimodal embedding model that can embed text, images, and audio in a shared vector space
- Enables richer semantic recall across modalities (e.g. recalling screen captures, images, audio notes alongside text memories)
- Reduces dependency on local Ollama availability for embedding — useful when Ollama is slow to start or unavailable
- The local qwen3-embedding:latest is text-only; Gemini embedding-2-preview opens the door to multimodal memory recall

**Work items:**
- [ ] Add `gemini` embedding provider to `embeddings/` alongside the existing Ollama provider
- [ ] Wire `gemini-embedding-2-preview` via `GEMINI_API_KEY` (already in env)
- [ ] Add `embedding.provider` config field: `"ollama"` (default, current) | `"gemini"`
- [ ] Support configurable `outputDimensions` (Gemini embedding-2-preview supports multiple dimension sizes)
- [ ] Add automatic reindexing trigger when configured dimensions change (mirror the core OpenClaw pattern)
- [ ] Optional: multimodal input support — allow image paths or base64 blobs to be embedded alongside text facts

**Config sketch:**
```json
{
  "embedding": {
    "provider": "gemini",
    "gemini": {
      "apiKey": "${GEMINI_API_KEY}",
      "model": "gemini-embedding-2-preview",
      "outputDimensions": 1536
    },
    "ollama": {
      "url": "http://localhost:11434",
      "model": "qwen3-embedding:latest",
      "dimensions": 4096,
      "timeoutMs": 15000
    }
  }
}
```

---

## 2. Migrate to Plugin SDK model auth

**Context:**
OpenClaw v2026.3.11 introduced `runtime.modelAuth` and plugin-sdk auth helpers so plugins can resolve provider/model API keys through the normal OpenClaw auth pipeline instead of reading env vars directly.

**Goal:**
Replace direct `process.env.GEMINI_API_KEY` / `process.env.OPENAI_API_KEY_BILLING` reads with `runtime.modelAuth` resolution for extraction and (once implemented) Gemini embedding calls.

**Why:**
- Aligns WorthyDB with the canonical OpenClaw credential management path
- Enables SecretRef-based credentials (e.g. keys stored in keychain rather than `.env`) without any WorthyDB changes
- Cleaner: no manual env-var wiring needed when deploying WorthyDB on a new setup
- Consistent with how other first-party plugins now resolve provider credentials

**Work items:**
- [ ] Audit all direct `process.env.*` API key reads in `extraction/` and `embeddings/`
- [ ] Replace them with `runtime.modelAuth(provider, model)` calls using the plugin-sdk helper
- [ ] Ensure graceful fallback: if auth resolution fails, surface a clear error rather than a silent undefined
- [ ] Update `config.ts` to remove `apiKey` from hard-wired extraction/embedding provider fields where auth is now resolved at runtime
- [ ] Test that both Gemini extraction and OpenAI fallback extraction still work through the new auth path
- [ ] Update `AGENTS.md` and `README.md` to document the new auth behaviour

---

## Priority order

1. **Plugin SDK model auth** — lower risk, improves robustness immediately, no new API surface
2. **Gemini embedding-2-preview text embeddings** — medium effort, solid quality improvement
3. **Multimodal embedding** — most ambitious; defer until text embedding path is proven stable
