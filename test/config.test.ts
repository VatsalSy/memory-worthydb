import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { parseConfig, resolveDbPathForAgent, worthyDbJsonSchema, worthyDbUiHints } from "../config.js";

describe("parseConfig", () => {
  it("uses defaults and process env fallback for Gemini", () => {
    process.env.GEMINI_API_KEY = "test-key";

    const config = parseConfig({});

    expect(config.extraction.primary.provider).toBe("gemini");
    expect(config.extraction.primary.apiKey).toBe("test-key");
    expect(config.extraction.fallback.model).toBe("gpt-4o-mini");
    expect(config.embedding.model).toBe("qwen3-embedding:latest");
    expect(config.dbPath).toContain("{agentId}");
  });

  it("allows missing placeholders to fall back to empty string", () => {
    const config = parseConfig({
      extraction: {
        primary: {
          provider: "gemini",
          apiKey: "${DEFINITELY_MISSING_VAR_123}",
        },
      },
    });
    expect(config.extraction.primary.apiKey).toBe("");
  });

  it("accepts a configurable recall minimum score", () => {
    const config = parseConfig({
      recallMinScore: 0.72,
    });

    expect(config.recallMinScore).toBe(0.72);
  });

  it("resolves fallback provider defaults and env-based api keys", () => {
    process.env.OPENAI_API_KEY = "openai-test-key";

    const config = parseConfig({
      extraction: {
        fallback: {
          provider: "openai",
          model: "gpt-4o-mini",
        },
      },
    });

    expect(config.extraction.fallback.provider).toBe("openai");
    expect(config.extraction.fallback.apiKey).toBe("openai-test-key");
    expect(config.extraction.fallback.baseUrl).toBe("https://api.openai.com/v1");
  });

  it("switches fallback defaults for Together", () => {
    process.env.TOGETHER_API_KEY = "together-test-key";

    const config = parseConfig({
      extraction: {
        fallback: {
          provider: "together",
          model: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
        },
      },
    });

    expect(config.extraction.fallback.provider).toBe("together");
    expect(config.extraction.fallback.apiKey).toBe("together-test-key");
    expect(config.extraction.fallback.baseUrl).toBe("https://api.together.xyz/v1");
  });

  it("accepts the new provider-neutral primary config", () => {
    process.env.OPENAI_API_KEY = "openai-primary-key";

    const config = parseConfig({
      extraction: {
        primary: {
          provider: "openai",
          model: "gpt-4o-mini",
        },
      },
    });

    expect(config.extraction.primary.provider).toBe("openai");
    expect(config.extraction.primary.apiKey).toBe("openai-primary-key");
    expect(config.extraction.primary.baseUrl).toBe("https://api.openai.com/v1");
  });

  it("keeps legacy gemini primary keys working during the transition", () => {
    process.env.GEMINI_API_KEY = "legacy-gemini-key";

    const config = parseConfig({
      extraction: {
        model: "gemini-2.5-flash-lite",
      },
    });

    expect(config.extraction.primary.provider).toBe("gemini");
    expect(config.extraction.primary.apiKey).toBe("legacy-gemini-key");
    expect(config.extraction.primary.model).toBe("gemini-2.5-flash-lite");
  });

  it("replaces agent id in db path templates", () => {
    const resolved = resolveDbPathForAgent(
      "~/.openclaw/memory/worthydb/{agentId}",
      "family-bot",
      (input) => input.replace("~", "/home/tester"),
    );

    expect(resolved).toBe("/home/tester/.openclaw/memory/worthydb/family-bot");
  });

  it("keeps the checked-in plugin manifest aligned with config exports", async () => {
    const raw = await readFile(new URL("../openclaw.plugin.json", import.meta.url), "utf8");
    const manifest = JSON.parse(raw) as {
      uiHints: unknown;
      configSchema: unknown;
    };

    expect(manifest.uiHints).toEqual(worthyDbUiHints);
    expect(manifest.configSchema).toEqual(worthyDbJsonSchema);
  });
});
