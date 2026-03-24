import { describe, expect, it, vi } from "vitest";
import {
  buildLegacyRecallHandler,
  buildRecallHandler,
  formatRecallContext,
} from "../hooks/recall.js";
import type { MemorySearchResult, WorthyDbConfig } from "../shared/contracts.js";

const baseConfig: WorthyDbConfig = {
  extraction: {
    maxFacts: 5,
    primary: {
      provider: "gemini",
      apiKey: "",
      model: "gemini-2.5-flash-lite",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      timeoutMs: 8000,
    },
    fallback: {
      provider: "openai",
      apiKey: "",
      model: "gpt-4o-mini",
      baseUrl: "https://api.openai.com/v1",
      timeoutMs: 8000,
    },
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

function buildResults(): MemorySearchResult[] {
  return [
    {
      entry: {
        id: "11111111-1111-1111-1111-111111111111",
        text: "Vatsal prefers concise replies.",
        vector: [1, 0, 0],
        category: "preference",
        importance: 0.9,
        createdAt: Date.now(),
        lastHitAt: 0,
        hitCount: 2,
        agentId: "default",
        sessionKey: "chat:default",
      },
      score: 0.92,
    },
  ];
}

describe("formatRecallContext", () => {
  it("renders worthydb context with recall counts", () => {
    const context = formatRecallContext(buildResults());

    expect(context).toContain("<worthydb-context>");
    expect(context).toContain("Vatsal prefers concise replies.");
    expect(context).toContain("[recalled 2x]");
  });
});

describe("buildRecallHandler", () => {
  it("uses before_prompt_build-compatible events", async () => {
    const results = buildResults();
    const touch = vi.fn(async () => undefined);
    const search = vi.fn(async () => results);
    const handler = buildRecallHandler({
      config: baseConfig,
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
      stores: {
        get: vi.fn(() => ({ search, touch })),
      },
      embeddings: {
        embed: vi.fn(async () => [1, 0, 0]),
      },
      extractor: {
        extractFacts: vi.fn(),
      },
    } as any);

    const result = await handler(
      { prompt: "Please answer briefly about my writing style.", messages: [] },
      { agentId: "default", sessionKey: "chat:default" },
    );

    expect(search).toHaveBeenCalledWith([1, 0, 0], {
      limit: baseConfig.maxRecallResults,
      minScore: baseConfig.recallMinScore,
    });
    expect(touch).toHaveBeenCalledTimes(1);
    expect(result?.prependContext).toContain("Vatsal prefers concise replies.");
  });

  it("skips short prompts", async () => {
    const search = vi.fn(async () => buildResults());
    const handler = buildRecallHandler({
      config: baseConfig,
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
      stores: {
        get: vi.fn(() => ({ search, touch: vi.fn() })),
      },
      embeddings: {
        embed: vi.fn(async () => [1, 0, 0]),
      },
      extractor: {
        extractFacts: vi.fn(),
      },
    } as any);

    const result = await handler({ prompt: "too short", messages: [] }, { agentId: "default" });

    expect(result).toBeUndefined();
    expect(search).not.toHaveBeenCalled();
  });
});

describe("buildLegacyRecallHandler", () => {
  it("keeps regression coverage for before_agent_start", async () => {
    const results = buildResults();
    const handler = buildLegacyRecallHandler({
      config: baseConfig,
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
      stores: {
        get: vi.fn(() => ({
          search: vi.fn(async () => results),
          touch: vi.fn(async () => undefined),
        })),
      },
      embeddings: {
        embed: vi.fn(async () => [1, 0, 0]),
      },
      extractor: {
        extractFacts: vi.fn(),
      },
    } as any);

    const result = await handler(
      { prompt: "Please remember how I like answers formatted.", messages: [] },
      { agentId: "default", sessionKey: "chat:default" },
    );

    expect(result?.prependContext).toContain("<worthydb-context>");
  });
});
