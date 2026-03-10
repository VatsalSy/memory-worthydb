import { Type } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import type { MemorySearchResult } from "../shared/contracts.js";
import type { WorthyDbRuntime } from "../shared/runtime.js";
import { resolveAgentId } from "../shared/runtime.js";

function formatResultsText(results: MemorySearchResult[]): string {
  return results
    .map(
      (result, index) =>
        `${index + 1}. [${result.entry.category}] ${result.entry.text} (${Math.round(result.score * 100)}%) [${result.entry.id.slice(0, 8)}]`,
    )
    .join("\n");
}

export function registerRecallTool(api: OpenClawPluginApi, runtime: WorthyDbRuntime): void {
  api.registerTool(
    (ctx) => ({
      name: "memory_recall",
      label: "Memory Recall",
      description:
        "Search long-term memories for relevant context about preferences, facts, or past decisions.",
      parameters: Type.Object({
        query: Type.String({ description: "Search query" }),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })),
      }),
      async execute(_toolCallId, params) {
        const parsed = params as { query?: unknown; limit?: unknown };
        const query = typeof parsed.query === "string" ? parsed.query : "";
        const limit =
          typeof parsed.limit === "number"
            ? Math.max(1, Math.min(20, Math.floor(parsed.limit)))
            : runtime.config.maxRecallResults;

        if (!query.trim()) {
          return {
            content: [{ type: "text", text: "Query is required." }],
            details: { error: "missing_query" },
          };
        }

        const db = runtime.stores.get(resolveAgentId(ctx));
        const vector = await runtime.embeddings.embed(query);
        const results = await db.search(vector, { limit, minScore: 0.1 });

        if (results.length === 0) {
          return {
            content: [{ type: "text", text: "No relevant memories found." }],
            details: { count: 0, memories: [] },
          };
        }

        await db.touch(results.map((result) => result.entry)).catch(() => undefined);

        return {
          content: [{ type: "text", text: `Found ${results.length} memories:\n\n${formatResultsText(results)}` }],
          details: {
            count: results.length,
            memories: results.map((result) => ({
              id: result.entry.id,
              text: result.entry.text,
              category: result.entry.category,
              importance: result.entry.importance,
              hitCount: result.entry.hitCount,
              score: result.score,
            })),
          },
        };
      },
    }),
    { name: "memory_recall" },
  );
}
