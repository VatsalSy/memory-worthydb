import { describe, expect, it } from "vitest";
import { parseConfig, resolveDbPathForAgent } from "../config.js";

describe("parseConfig", () => {
  it("uses defaults and process env fallback for Gemini", () => {
    process.env.GEMINI_API_KEY = "test-key";

    const config = parseConfig({});

    expect(config.extraction.apiKey).toBe("test-key");
    expect(config.embedding.model).toBe("qwen3-embedding:latest");
    expect(config.dbPath).toContain("{agentId}");
  });

  it("allows missing placeholders to fall back to empty string", () => {
    const config = parseConfig({
      extraction: {
        apiKey: "${DEFINITELY_MISSING_VAR_123}",
      },
    });
    expect(config.extraction.apiKey).toBe("");
  });

  it("replaces agent id in db path templates", () => {
    const resolved = resolveDbPathForAgent(
      "~/.openclaw/memory/worthydb/{agentId}",
      "family-bot",
      (input) => input.replace("~", "/home/tester"),
    );

    expect(resolved).toBe("/home/tester/.openclaw/memory/worthydb/family-bot");
  });
});
