import { describe, expect, it, vi } from "vitest";
import { MemoryDB } from "../db/store.js";
import { buildCaptureHandler, prepareCaptureTurn } from "../hooks/capture.js";
import type { MemoryEntry, WorthyDbConfig } from "../shared/contracts.js";
import { detectMemoryCategory } from "../shared/text.js";

const baseConfig: WorthyDbConfig = {
  extraction: {
    apiKey: "",
    model: "gemini-2.5-flash-lite",
    maxFacts: 5,
    timeoutMs: 8000,
  },
  embedding: {
    ollamaUrl: "http://localhost:11434",
    model: "qwen3-embedding:latest",
    dimensions: 3,
    timeoutMs: 5000,
  },
  dbPath: "~/.openclaw/memory/worthydb/{agentId}",
  autoCapture: true,
  autoRecall: true,
  maxRecallResults: 8,
  recallMinScore: 0.45,
  dedup: { threshold: 0.95 },
  ttl: {
    preference: 365,
    decision: 180,
    entity: 0,
    fact: 90,
    other: 30,
  },
  capture: {
    skipCron: true,
    skipNoReply: true,
    minTurnChars: 20,
    maxTurnChars: 8000,
  },
};

function buildTurnEvent() {
  return {
    success: true,
    messages: [
      { role: "user", content: [{ type: "text", text: "Remember that I prefer concise replies." }] },
      { role: "assistant", content: [{ type: "text", text: "I will keep replies concise." }] },
    ],
  };
}

function buildEntry(id: string, hitCount = 0): MemoryEntry {
  return {
    id,
    text: "memory",
    vector: [1, 0, 0],
    category: "fact",
    importance: 0.5,
    createdAt: Date.now(),
    lastHitAt: 0,
    hitCount,
    agentId: "default",
    sessionKey: "",
  };
}

describe("prepareCaptureTurn", () => {
  it("skips cron-agent sessions", () => {
    const turn = prepareCaptureTurn(buildTurnEvent(), { agentId: "cron-agent" }, baseConfig);
    expect(turn).toBeNull();
  });
});

describe("buildCaptureHandler", () => {
  it("embeds facts concurrently during capture", async () => {
    let activeEmbeds = 0;
    let maxConcurrentEmbeds = 0;
    const store = {
      findDuplicate: vi.fn(async () => null),
      store: vi.fn(async () => undefined),
    };

    const handler = buildCaptureHandler({
      config: baseConfig,
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
      stores: {
        get: vi.fn(() => store),
      },
      embeddings: {
        embed: vi.fn(async (_text: string) => {
          activeEmbeds += 1;
          maxConcurrentEmbeds = Math.max(maxConcurrentEmbeds, activeEmbeds);
          await new Promise((resolve) => setTimeout(resolve, 10));
          activeEmbeds -= 1;
          return [1, 0, 0];
        }),
      },
      extractor: {
        extractFacts: vi.fn(async () => [
          { text: "User prefers concise replies.", category: "preference", importance: 0.9 },
          { text: "Assistant should stay brief.", category: "decision", importance: 0.7 },
          { text: "Concise answers are preferred.", category: "preference", importance: 0.8 },
        ]),
      },
    } as any);

    await handler(buildTurnEvent(), { agentId: "default", sessionKey: "chat:default" });

    expect(store.store).toHaveBeenCalledTimes(3);
    expect(maxConcurrentEmbeds).toBeGreaterThan(1);
  });
});

describe("MemoryDB", () => {
  it("resets initPromise after initialization failure", async () => {
    const db = new MemoryDB("/tmp/worthydb-test", 3) as any;
    db.doInitialize = vi.fn(async () => {
      throw new Error("boom");
    });

    await expect(db.ensureInitialized()).rejects.toThrow("boom");
    expect(db.initPromise).toBeNull();
  });

  it("all() does not apply a limit by default", async () => {
    const db = new MemoryDB("/tmp/worthydb-test", 3) as any;
    let appliedLimit: number | undefined;
    db.table = {
      query: () => {
        const q = {
          limit: (n: number) => {
            appliedLimit = n;
            return q;
          },
          toArray: async () => [],
        };
        return q;
      },
    };

    await db.all();
    expect(appliedLimit).toBeUndefined();

    await db.all(50);
    expect(appliedLimit).toBe(50);
  });

  it("queries by id without loading the full table", async () => {
    const db = new MemoryDB("/tmp/worthydb-test", 3) as any;
    let whereClause = "";
    db.table = {
      query: () => ({
        where: (clause: string) => {
          whereClause = clause;
          return {
            limit: () => ({
              toArray: async () => [
                {
                  id: "11111111-1111-1111-1111-111111111111",
                  text: "memory",
                  vector: [1, 0, 0],
                  category: "fact",
                  importance: 0.5,
                  createdAt: 1,
                  lastHitAt: 0,
                  hitCount: 0,
                  agentId: "default",
                  sessionKey: "",
                },
              ],
            }),
          };
        },
      }),
    };
    db.all = vi.fn(async () => {
      throw new Error("should not load all rows");
    });

    const entry = await db.getById("11111111-1111-1111-1111-111111111111");

    expect(whereClause).toBe("id = '11111111-1111-1111-1111-111111111111'");
    expect(entry?.id).toBe("11111111-1111-1111-1111-111111111111");
  });

  it("updates recall metadata concurrently", async () => {
    const db = new MemoryDB("/tmp/worthydb-test", 3) as any;
    let activeUpdates = 0;
    let maxConcurrentUpdates = 0;
    db.table = {
      update: vi.fn(async () => {
        activeUpdates += 1;
        maxConcurrentUpdates = Math.max(maxConcurrentUpdates, activeUpdates);
        await new Promise((resolve) => setTimeout(resolve, 10));
        activeUpdates -= 1;
      }),
    };

    await db.touch(
      [
        buildEntry("11111111-1111-1111-1111-111111111111"),
        buildEntry("22222222-2222-2222-2222-222222222222", 1),
        buildEntry("33333333-3333-3333-3333-333333333333", 2),
      ],
      123,
    );

    expect(db.table.update).toHaveBeenCalledTimes(3);
    expect(maxConcurrentUpdates).toBeGreaterThan(1);
  });
});

describe("detectMemoryCategory", () => {
  it("does not classify generic 'is called' phrasing as an entity", () => {
    expect(detectMemoryCategory("This function is called renderMemory")).toBe("fact");
  });

  it("keeps explicit person naming phrases in the entity bucket", () => {
    expect(detectMemoryCategory("Her dog is called Milo.")).toBe("entity");
  });
});
