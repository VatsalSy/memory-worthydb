import { Type } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { MEMORY_CATEGORIES, type MemoryCategory } from "../shared/contracts.js";
import type { WorthyDbRuntime } from "../shared/runtime.js";
import { resolveAgentId, resolveSessionKey } from "../shared/runtime.js";
import { detectMemoryCategory, sanitizeMemoryText } from "../shared/text.js";

const MEMORY_CATEGORY_SCHEMA = Type.Unsafe<MemoryCategory>({
  type: "string",
  enum: [...MEMORY_CATEGORIES],
});

export function registerStoreTool(api: OpenClawPluginApi, runtime: WorthyDbRuntime): void {
  api.registerTool(
    (ctx) => ({
      name: "memory_store",
      label: "Memory Store",
      description: "Store an explicit durable memory entry for this agent.",
      parameters: Type.Object({
        text: Type.String({ description: "Text to remember" }),
        importance: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
        category: Type.Optional(MEMORY_CATEGORY_SCHEMA),
        force: Type.Optional(Type.Boolean({ description: "Store even if a duplicate exists" })),
      }),
      async execute(_toolCallId, params) {
        const input = params as {
          text?: string;
          importance?: number;
          category?: MemoryCategory;
          force?: boolean;
        };

        const text = sanitizeMemoryText(input.text ?? "", 500);
        if (!text) {
          return {
            content: [{ type: "text", text: "Text is required." }],
            details: { error: "missing_text" },
          };
        }

        const agentId = resolveAgentId(ctx);
        const db = runtime.stores.get(agentId);
        const vector = await runtime.embeddings.embed(text);

        if (!input.force) {
          const duplicate = await db.findDuplicate(vector, runtime.config.dedup.threshold);
          if (duplicate) {
            return {
              content: [
                {
                  type: "text",
                  text: `Similar memory already exists: "${duplicate.entry.text}" [${duplicate.entry.id.slice(0, 8)}]`,
                },
              ],
              details: {
                action: "duplicate",
                existingId: duplicate.entry.id,
                existingText: duplicate.entry.text,
              },
            };
          }
        }

        const entry = await db.store({
          text,
          vector,
          category: input.category ?? detectMemoryCategory(text),
          importance: typeof input.importance === "number" ? input.importance : 0.7,
          agentId,
          sessionKey: resolveSessionKey(ctx),
        });

        return {
          content: [{ type: "text", text: `Stored memory ${entry.id.slice(0, 8)}: ${entry.text}` }],
          details: {
            action: "created",
            id: entry.id,
            category: entry.category,
          },
        };
      },
    }),
    { name: "memory_store" },
  );
}
