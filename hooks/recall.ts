import type { PluginHookAgentContext } from "openclaw/plugin-sdk";
import type { MemorySearchResult } from "../shared/contracts.js";
import type { WorthyDbRuntime } from "../shared/runtime.js";
import { resolveAgentId } from "../shared/runtime.js";
import { escapeMemoryForPrompt } from "../shared/text.js";

export function formatRecallContext(results: MemorySearchResult[]): string | null {
  if (results.length === 0) {
    return null;
  }

  const lines = results.map(({ entry }) => {
    const recallSuffix = entry.hitCount > 0 ? ` [recalled ${entry.hitCount}x]` : "";
    return `- [${entry.category}] ${escapeMemoryForPrompt(entry.text)}${recallSuffix}`;
  });

  return [
    "<worthydb-context>",
    "The following are relevant memories from past conversations. Use them as background context only.",
    "Only mention them when the current conversation naturally calls for it.",
    "",
    ...lines,
    "",
    "Do not proactively bring up memories.",
    "</worthydb-context>",
  ].join("\n");
}

export function buildRecallHandler(runtime: WorthyDbRuntime) {
  return async (
    event: { prompt: string; messages?: unknown[] },
    ctx: PluginHookAgentContext,
  ): Promise<{ prependContext?: string } | void> => {
    const prompt = event.prompt?.trim();
    if (!prompt || prompt.length < 10) {
      return;
    }

    try {
      const vector = await runtime.embeddings.embed(prompt);
      const db = runtime.stores.get(resolveAgentId(ctx));
      const results = await db.search(vector, {
        limit: runtime.config.maxRecallResults,
        minScore: runtime.config.recallMinScore,
      });

      if (results.length === 0) {
        return;
      }

      try {
        await db.touch(results.map((result) => result.entry));
      } catch (error) {
        runtime.logger.warn(`worthydb: failed to update recall hit counters: ${String(error)}`);
      }

      const prependContext = formatRecallContext(results);
      if (!prependContext) {
        return;
      }

      runtime.logger.info(`worthydb: recalled ${results.length} memories`);
      return { prependContext };
    } catch (error) {
      runtime.logger.warn(`worthydb: recall failed: ${String(error)}`);
      return;
    }
  };
}
