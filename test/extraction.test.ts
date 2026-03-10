import { describe, expect, it } from "vitest";
import { buildExtractionPrompt, parseExtractedFacts } from "../extraction/gemini.js";

describe("parseExtractedFacts", () => {
  it("parses valid JSON arrays and clamps to max facts", () => {
    const facts = parseExtractedFacts(
      JSON.stringify([
        { text: "Vatsal prefers concise replies.", category: "preference", importance: 1 },
        { text: "Trips are saved under workspace-capture/outbox/trips.", category: "fact", importance: 0.7 },
      ]),
      1,
    );

    expect(facts).toHaveLength(1);
    expect(facts[0]?.category).toBe("preference");
  });

  it("falls back to an empty list for malformed JSON", () => {
    const facts = parseExtractedFacts("not-json", 5);
    expect(facts).toEqual([]);
  });

  it("builds a prompt with both sides of the turn", () => {
    const prompt = buildExtractionPrompt("User text", "Assistant text", 5);
    expect(prompt).toContain("User: User text");
    expect(prompt).toContain("Assistant: Assistant text");
  });
});
