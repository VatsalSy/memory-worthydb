import type { PluginLogger } from "openclaw/plugin-sdk";
import type { MemoryStoreManager } from "../db/store.js";
import type { OllamaEmbeddingsClient } from "../embeddings/ollama.js";
import type { GeminiExtractionClient } from "../extraction/gemini.js";
import type { AgentScopedContext, WorthyDbConfig } from "./contracts.js";

export type WorthyDbRuntime = {
  config: WorthyDbConfig;
  logger: PluginLogger;
  stores: MemoryStoreManager;
  embeddings: OllamaEmbeddingsClient;
  extractor: GeminiExtractionClient;
};

export function resolveAgentId(ctx?: AgentScopedContext): string {
  const value = ctx?.agentId?.trim();
  return value && value.length > 0 ? value : "default";
}

export function resolveSessionKey(ctx?: AgentScopedContext): string {
  return ctx?.sessionKey?.trim() ?? "";
}
