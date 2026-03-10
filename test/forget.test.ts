import { describe, expect, it, vi } from "vitest";
import { registerForgetTool } from "../tools/forget.js";

describe("memory_forget", () => {
  it("applies category filtering after semantic search with a larger candidate pool", async () => {
    const api: any = { registerTool: vi.fn() };
    const db: any = {
      search: vi.fn(async (_vector, options) => {
        // Return 10 results, some matching 'fact' and some 'preference'
        return Array.from({ length: options.limit }).map((_, i) => ({
          entry: {
            id: `id-${i}`,
            text: `text-${i}`,
            category: i % 2 === 0 ? "fact" : "preference",
          },
          score: 0.9 - i * 0.01,
        }));
      }),
      delete: vi.fn(),
    };
    const runtime: any = {
      stores: { get: () => db },
      embeddings: { embed: async () => [1, 0, 0] },
      config: { dedup: { threshold: 0.9 } },
    };

    registerForgetTool(api, runtime);
    const tool = api.registerTool.mock.calls[0][0]({ agentId: "main" });

    // Request with category 'preference'
    const result = await tool.execute("call-1", {
      query: "something",
      category: "preference",
    });

    // Verify search was called with a larger limit (25)
    expect(db.search).toHaveBeenCalledWith(expect.any(Array), expect.objectContaining({ limit: 25 }));
    
    // Verify result contains candidates with 'preference' category
    expect(result.details.candidates[0].category).toBe("preference");
    // Should have 5 candidates (the sliced limit)
    expect(result.details.candidates).toHaveLength(5);
  });
});
