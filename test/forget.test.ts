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


  it("uses bounded preview and bulk-delete path for olderThan", async () => {
    const api: any = { registerTool: vi.fn() };
    const db: any = {
      all: vi.fn(async () => [
        { id: "11111111-1111-1111-1111-111111111111", text: "old fact", category: "fact", createdAt: Date.now() - 9 * 24 * 60 * 60 * 1000 },
        { id: "22222222-2222-2222-2222-222222222222", text: "new pref", category: "preference", createdAt: Date.now() - 2 * 24 * 60 * 60 * 1000 },
      ]),
      deleteOlderThan: vi.fn(async () => undefined),
    };
    const runtime: any = {
      stores: { get: () => db },
      embeddings: { embed: async () => [1, 0, 0] },
      config: { dedup: { threshold: 0.9 } },
    };

    registerForgetTool(api, runtime);
    const tool = api.registerTool.mock.calls[0][0]({ agentId: "main" });

    const preview = await tool.execute("call-preview", { olderThan: 7 });
    expect(db.all).toHaveBeenCalledWith(1000);
    expect(preview.details.action).toBe("preview");
    expect(preview.details.sampled).toBe(true);

    const forceDelete = await tool.execute("call-force", { olderThan: 7, category: "fact", force: true });
    expect(db.deleteOlderThan).toHaveBeenCalledWith(expect.any(Number), "fact");
    expect(forceDelete.details.action).toBe("deleted_bulk");
  });
});
