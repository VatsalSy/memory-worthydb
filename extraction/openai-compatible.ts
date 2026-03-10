import type { PluginLogger } from "openclaw/plugin-sdk";
import type { ExtractedFact, ExtractionProviderConfig, MemoryExtractor } from "../shared/contracts.js";
import { parseExtractedFactsResult, buildExtractionPrompt } from "./gemini.js";

const MAX_RESPONSE_TOKENS = 300;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractChoiceText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .flatMap((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return [];
      }
      const block = item as Record<string, unknown>;
      if (typeof block.text === "string") {
        return [block.text];
      }
      return [];
    })
    .join("\n");
}

export class OpenAiCompatibleExtractionClient implements MemoryExtractor {
  constructor(
    private readonly config: ExtractionProviderConfig,
    private readonly maxFacts: number,
    private readonly logger: PluginLogger,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async extractFacts(userText: string, assistantText: string): Promise<ExtractedFact[]> {
    if (!this.config.apiKey || !this.config.model) {
      return [];
    }

    const prompt = buildExtractionPrompt(userText, assistantText, this.maxFacts);
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await this.fetchImpl(`${this.config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.config.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: this.config.model,
            messages: [{ role: "user", content: prompt }],
            temperature: 0,
            max_tokens: MAX_RESPONSE_TOKENS,
          }),
          signal: AbortSignal.timeout(this.config.timeoutMs),
        });

        if (!response.ok) {
          const body = await response.text();
          if ((response.status === 429 || response.status >= 500) && attempt < 2) {
            await sleep(250 * 2 ** attempt);
            continue;
          }
          throw new Error(
            `${this.config.provider} extraction request failed (${response.status}): ${body.slice(0, 400)}`,
          );
        }

        const data = (await response.json()) as Record<string, unknown>;
        const choices = Array.isArray(data.choices) ? (data.choices as Array<Record<string, unknown>>) : [];
        const message = choices[0]?.message as Record<string, unknown> | undefined;
        const rawText = extractChoiceText(message?.content);
        const parsed = parseExtractedFactsResult(rawText, this.maxFacts);
        if (!parsed.parsed) {
          throw new Error(`${this.config.provider} extraction returned invalid JSON`);
        }

        this.logger.debug?.(
          `worthydb: ${this.config.provider} fallback produced ${parsed.facts.length} extracted facts`,
        );
        return parsed.facts;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt < 2) {
          await sleep(250 * 2 ** attempt);
          continue;
        }
      }
    }
    throw lastError ?? new Error(`${this.config.provider} extraction failed`);
  }
}
