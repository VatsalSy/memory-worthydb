import { Type } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { MEMORY_CATEGORIES, type MemoryCategory } from "../shared/contracts.js";
import type { WorthyDbRuntime } from "../shared/runtime.js";
import { resolveAgentId } from "../shared/runtime.js";

const MEMORY_CATEGORY_SCHEMA = Type.Unsafe<MemoryCategory>({
  type: "string",
  enum: [...MEMORY_CATEGORIES],
});

export function registerForgetTool(api: OpenClawPluginApi, runtime: WorthyDbRuntime): void {
  api.registerTool(
    (ctx) => ({
      name: "memory_forget",
      label: "Memory Forget",
      description: "Delete memories by exact id, semantic query, or age/category filters.",
      parameters: Type.Object({
        memoryId: Type.Optional(Type.String({ description: "Exact memory id to delete" })),
        query: Type.Optional(Type.String({ description: "Semantic query used to find a memory" })),
        olderThan: Type.Optional(
          Type.Integer({ minimum: 1, description: "Delete memories older than N days" }),
        ),
        category: Type.Optional(MEMORY_CATEGORY_SCHEMA),
        force: Type.Optional(
          Type.Boolean({ description: "Delete the best semantic match or bulk preview immediately" }),
        ),
      }),
      async execute(_toolCallId, params) {
        const input = params as {
          memoryId?: string;
          query?: string;
          olderThan?: number;
          category?: MemoryCategory;
          force?: boolean;
        };

        const db = runtime.stores.get(resolveAgentId(ctx));

        if (input.memoryId) {
          await db.delete(input.memoryId);
          return {
            content: [{ type: "text", text: `Deleted memory ${input.memoryId}.` }],
            details: { action: "deleted", ids: [input.memoryId] },
          };
        }

        if (typeof input.olderThan === "number") {
          const cutoff = Date.now() - input.olderThan * 24 * 60 * 60 * 1000;
          const candidates = (await db.all()).filter(
            (entry) =>
              entry.createdAt <= cutoff &&
              (input.category ? entry.category === input.category : true),
          );

          if (candidates.length === 0) {
            return {
              content: [{ type: "text", text: "No memories matched that age/category filter." }],
              details: { action: "none", count: 0 },
            };
          }

          if (!input.force) {
            return {
              content: [
                {
                  type: "text",
                  text: `Found ${candidates.length} memories. Re-run with force=true to delete them.`,
                },
              ],
              details: {
                action: "preview",
                count: candidates.length,
                candidates: candidates.map((entry) => ({
                  id: entry.id,
                  text: entry.text,
                  category: entry.category,
                  createdAt: entry.createdAt,
                })),
              },
            };
          }

          await db.deleteMany(candidates.map((entry) => entry.id));
          return {
            content: [{ type: "text", text: `Deleted ${candidates.length} memories.` }],
            details: {
              action: "deleted",
              ids: candidates.map((entry) => entry.id),
            },
          };
        }

        if (input.query) {
          const vector = await runtime.embeddings.embed(input.query);
          // Get more results to allow for category filtering
          let results = await db.search(vector, { limit: 25, minScore: 0.7 });
          if (input.category) {
            results = results.filter((result) => result.entry.category === input.category);
          }
          // Slice to the final intended candidate limit
          results = results.slice(0, 5);

          if (results.length === 0) {
            return {
              content: [{ type: "text", text: "No matching memories found." }],
              details: { action: "none", count: 0 },
            };
          }

          if (results.length === 1 || input.force) {
            await db.delete(results[0].entry.id);
            return {
              content: [{ type: "text", text: `Deleted memory: ${results[0].entry.text}` }],
              details: { action: "deleted", ids: [results[0].entry.id] },
            };
          }

          return {
            content: [
              {
                type: "text",
                text:
                  "Multiple candidate memories matched. Re-run with memoryId or force=true to delete the best match.",
              },
            ],
            details: {
              action: "candidates",
              candidates: results.map((result) => ({
                id: result.entry.id,
                text: result.entry.text,
                category: result.entry.category,
                score: result.score,
              })),
            },
          };
        }

        return {
          content: [
            {
              type: "text",
              text: "Provide memoryId, query, or olderThan to forget memories.",
            },
          ],
          details: { error: "missing_selector" },
        };
      },
    }),
    { name: "memory_forget" },
  );
}
