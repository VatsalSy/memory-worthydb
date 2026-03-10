import { describe, expect, it } from "vitest";
import { pruneNearDuplicates, shouldExpireEntry } from "../prune/prune.js";
import type { MemoryDB } from "../db/store.js";
import type { MemoryEntry, WorthyDbConfig } from "../shared/contracts.js";

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

function buildEntry(partial: Partial<MemoryEntry>): MemoryEntry {
  return {
    id: partial.id ?? "11111111-1111-1111-1111-111111111111",
    text: partial.text ?? "memory",
    vector: partial.vector ?? [1, 0, 0],
    category: partial.category ?? "fact",
    importance: partial.importance ?? 0.7,
    createdAt: partial.createdAt ?? Date.now(),
    lastHitAt: partial.lastHitAt ?? 0,
    hitCount: partial.hitCount ?? 0,
    agentId: partial.agentId ?? "default",
    sessionKey: partial.sessionKey ?? "",
  };
}

describe("shouldExpireEntry", () => {
  it("expires unrecalled facts after their TTL", () => {
    const now = Date.now();
    const entry = buildEntry({
      createdAt: now - 91 * 24 * 60 * 60 * 1000,
      hitCount: 0,
      category: "fact",
    });

    expect(shouldExpireEntry(entry, baseConfig.ttl, now)).toBe(true);
  });

  it("keeps entity memories forever when ttl is zero", () => {
    const now = Date.now();
    const entry = buildEntry({
      category: "entity",
      createdAt: now - 500 * 24 * 60 * 60 * 1000,
    });

    expect(shouldExpireEntry(entry, baseConfig.ttl, now)).toBe(false);
  });
});

describe("pruneNearDuplicates", () => {
  it("keeps the strongest memory in a similar cluster", async () => {
    const entries = [
      buildEntry({
        id: "11111111-1111-1111-1111-111111111111",
        text: "Vatsal prefers concise replies.",
        vector: [1, 0, 0],
        importance: 0.9,
      }),
      buildEntry({
        id: "22222222-2222-2222-2222-222222222222",
        text: "Vatsal likes concise answers.",
        vector: [0.99, 0.01, 0],
        importance: 0.6,
      }),
    ];

    const deleted: string[][] = [];
    const db = {
      all: async () => entries,
      deleteMany: async (ids: string[]) => {
        deleted.push(ids);
        return ids.length;
      },
    } as unknown as MemoryDB;

    const result = await pruneNearDuplicates(db, baseConfig, { dryRun: false, minSimilarity: 0.8 });

    expect(result.deletedIds).toEqual(["22222222-2222-2222-2222-222222222222"]);
    expect(deleted).toEqual([["22222222-2222-2222-2222-222222222222"]]);
  });

  it("enforces the spec floor even when write-time dedup is configured lower", async () => {
    const entries = [
      buildEntry({
        id: "11111111-1111-1111-1111-111111111111",
        vector: [1, 0, 0],
      }),
      buildEntry({
        id: "22222222-2222-2222-2222-222222222222",
        vector: [0.75, 0.6614378278, 0],
      }),
    ];

    const deleted: string[][] = [];
    const db = {
      all: async () => entries,
      deleteMany: async (ids: string[]) => {
        deleted.push(ids);
        return ids.length;
      },
    } as unknown as MemoryDB;

    const result = await pruneNearDuplicates(
      db,
      {
        ...baseConfig,
        dedup: { threshold: 0.85 },
      },
      { dryRun: false },
    );

    expect(result.deletedIds).toEqual([]);
    expect(deleted).toEqual([[]]);
  });
});
