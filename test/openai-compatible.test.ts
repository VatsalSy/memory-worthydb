import { describe, expect, it, vi } from "vitest";
import { OpenAiCompatibleExtractionClient } from "../extraction/openai-compatible.js";
import { buildExtractionClient } from "../extraction/client.js";

describe("OpenAiCompatibleExtractionClient", () => {
  it("posts extraction prompts to an OpenAI-compatible chat completions endpoint", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify([
                { text: "Vatsal prefers concise replies.", category: "preference", importance: 0.9 },
              ]),
            },
          },
        ],
      }),
    })) as any;

    const client = new OpenAiCompatibleExtractionClient(
      {
        provider: "openai",
        apiKey: "test-key",
        model: "gpt-4o-mini",
        baseUrl: "https://api.openai.com/v1",
        timeoutMs: 8000,
      },
      5,
      { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any,
      fetchImpl,
    );

    const facts = await client.extractFacts("User text", "Assistant text");

    expect(facts).toEqual([
      { text: "Vatsal prefers concise replies.", category: "preference", importance: 0.9 },
    ]);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.openai.com/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer test-key",
        }),
      }),
    );
  });
});

describe("buildExtractionClient", () => {
  it("supports an OpenAI primary extractor", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify([
                { text: "Vatsal prefers concise replies.", category: "preference", importance: 0.9 },
              ]),
            },
          },
        ],
      }),
    })) as any;

    const extractor = buildExtractionClient(
      {
        maxFacts: 5,
        primary: {
          provider: "openai",
          apiKey: "primary-key",
          model: "gpt-4o-mini",
          baseUrl: "https://api.openai.com/v1",
          timeoutMs: 8000,
        },
        fallback: {
          provider: "gemini",
          apiKey: "",
          model: "gemini-2.5-flash-lite",
          baseUrl: "https://generativelanguage.googleapis.com/v1beta",
          timeoutMs: 8000,
        },
      },
      { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any,
      fetchImpl,
    );

    const facts = await extractor.extractFacts("User text", "Assistant text");

    expect(facts).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.openai.com/v1/chat/completions",
      expect.any(Object),
    );
  });

  it("uses the fallback extractor when Gemini is not configured", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify([
                { text: "Vatsal prefers concise replies.", category: "preference", importance: 0.9 },
              ]),
            },
          },
        ],
      }),
    })) as any;

    const extractor = buildExtractionClient(
      {
        maxFacts: 5,
        primary: {
          provider: "gemini",
          apiKey: "",
          model: "gemini-2.5-flash-lite",
          baseUrl: "https://generativelanguage.googleapis.com/v1beta",
          timeoutMs: 8000,
        },
        fallback: {
          provider: "together",
          apiKey: "fallback-key",
          model: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
          baseUrl: "https://api.together.xyz/v1",
          timeoutMs: 8000,
        },
      },
      { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any,
      fetchImpl,
    );

    const facts = await extractor.extractFacts("User text", "Assistant text");

    expect(facts).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.together.xyz/v1/chat/completions",
      expect.any(Object),
    );
  });
});
