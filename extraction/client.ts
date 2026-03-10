import type { PluginLogger } from "openclaw/plugin-sdk";
import { GeminiExtractionClient } from "./gemini.js";
import { OpenAiCompatibleExtractionClient } from "./openai-compatible.js";
import type { ExtractionProviderConfig, MemoryExtractor, WorthyDbConfig } from "../shared/contracts.js";

function hasConfiguredProvider(config: ExtractionProviderConfig): boolean {
  return Boolean(config.apiKey && config.model);
}

function createProviderClient(
  config: ExtractionProviderConfig,
  maxFacts: number,
  logger: PluginLogger,
  fetchImpl: typeof fetch,
): MemoryExtractor {
  if (config.provider === "gemini") {
    return new GeminiExtractionClient(config, maxFacts, logger, fetchImpl);
  }
  return new OpenAiCompatibleExtractionClient(config, maxFacts, logger, fetchImpl);
}

export function buildExtractionClient(
  config: WorthyDbConfig["extraction"],
  logger: PluginLogger,
  fetchImpl: typeof fetch = fetch,
): MemoryExtractor {
  const primary = createProviderClient(config.primary, config.maxFacts, logger, fetchImpl);

  if (!hasConfiguredProvider(config.fallback)) {
    return primary;
  }

  const fallback = createProviderClient(config.fallback, config.maxFacts, logger, fetchImpl);

  return {
    async extractFacts(userText: string, assistantText: string) {
      if (!hasConfiguredProvider(config.primary)) {
        logger.info(
          `worthydb: primary ${config.primary.provider} extractor is not configured; using ${config.fallback.provider} fallback extraction`,
        );
        return fallback.extractFacts(userText, assistantText);
      }

      try {
        return await primary.extractFacts(userText, assistantText);
      } catch (error) {
        logger.warn(
          `worthydb: ${config.primary.provider} extraction failed; using ${config.fallback.provider} fallback: ${String(error)}`,
        );
        return fallback.extractFacts(userText, assistantText);
      }
    },
  };
}
