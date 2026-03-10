import type { PluginLogger } from "openclaw/plugin-sdk";
import type { ExtractedFact, ExtractionProviderConfig } from "../shared/contracts.js";
import {
  clamp,
  detectMemoryCategory,
  isMemoryCategory,
  looksLikePromptInjection,
  sanitizeMemoryText,
  uniqueByNormalizedText,
} from "../shared/text.js";

const MAX_RESPONSE_TOKENS = 300;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractJsonArray(rawText: string): string {
  const trimmed = rawText.trim();
  if (trimmed.startsWith("[")) {
    return trimmed;
  }
  const start = trimmed.indexOf("[");
  const end = trimmed.lastIndexOf("]");
  if (start >= 0 && end > start) {
    return trimmed.slice(start, end + 1);
  }
  return "[]";
}

export function buildExtractionPrompt(
  userText: string,
  assistantText: string,
  maxFacts: number,
): string {
  return [
    `Extract 0-${maxFacts} atomic, self-contained memory facts from this conversation turn.`,
    "Focus on: durable preferences, explicit decisions, stable entity facts, and long-lived context that will still matter in future conversations.",
    "Only keep facts that are likely useful at least a few weeks from now.",
    "Ignore: transient task details, one-off requests, assistant actions, and anything that only matters in this session.",
    "Never store ephemeral session-state such as current time/date/day, temporary mood or stress, short-term availability, current weather, or statements like having a rough or hellish day.",
    "Never store assistant persona/style facts unless the user explicitly asks to remember a standing preference about how the assistant should behave.",
    "Never store facts whose main subject is the assistant unless they encode a durable user instruction or decision.",
    "",
    'Return only a JSON array of objects: [{"text":"...","category":"preference|decision|entity|fact|other","importance":0.0}]',
    "If nothing is worth remembering, return [].",
    "",
    "Conversation:",
    `User: ${userText}`,
    `Assistant: ${assistantText}`,
  ].join("\n");
}

export function normalizeExtractedFact(value: unknown): ExtractedFact | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const text = sanitizeMemoryText(String(record.text ?? ""), 500);
  if (text.length < 3 || looksLikePromptInjection(text)) {
    return null;
  }

  const category = isMemoryCategory(record.category)
    ? record.category
    : detectMemoryCategory(text);
  const importance =
    typeof record.importance === "number" ? clamp(record.importance, 0, 1) : 0.7;

  return {
    text,
    category,
    importance,
  };
}

export function parseExtractedFacts(rawText: string, maxFacts: number): ExtractedFact[] {
  return parseExtractedFactsResult(rawText, maxFacts).facts;
}

export function parseExtractedFactsResult(
  rawText: string,
  maxFacts: number,
): { facts: ExtractedFact[]; parsed: boolean } {
  try {
    const parsed = JSON.parse(extractJsonArray(rawText));
    if (!Array.isArray(parsed)) {
      return { facts: [], parsed: false };
    }
    return {
      facts: uniqueByNormalizedText(
      parsed.map(normalizeExtractedFact).filter((fact): fact is ExtractedFact => fact !== null),
      ).slice(0, maxFacts),
      parsed: true,
    };
  } catch {
    return { facts: [], parsed: false };
  }
}

export class GeminiExtractionClient {
  private warnedMissingKey = false;

  constructor(
    private readonly config: ExtractionProviderConfig,
    private readonly maxFacts: number,
    private readonly logger: PluginLogger,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async extractFacts(userText: string, assistantText: string): Promise<ExtractedFact[]> {
    if (!this.config.apiKey) {
      if (!this.warnedMissingKey) {
        this.warnedMissingKey = true;
        this.logger.warn("worthydb: GEMINI_API_KEY is not configured; auto-capture extraction is disabled");
      }
      return [];
    }

    const prompt = buildExtractionPrompt(userText, assistantText, this.maxFacts);
    const payload = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: MAX_RESPONSE_TOKENS,
        responseMimeType: "application/json",
      },
    };

    let lastError: Error | null = null;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await this.fetchImpl(
          `${this.config.baseUrl.replace(/\/$/, "")}/models/${this.config.model}:generateContent?key=${this.config.apiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(this.config.timeoutMs),
          },
        );

        if (!response.ok) {
          const body = await response.text();
          if ((response.status === 429 || response.status >= 500) && attempt < 2) {
            await sleep(250 * 2 ** attempt);
            continue;
          }
          throw new Error(`Gemini request failed (${response.status}): ${body.slice(0, 400)}`);
        }

        const data = (await response.json()) as Record<string, unknown>;
        const candidates = Array.isArray(data.candidates)
          ? (data.candidates as Array<Record<string, unknown>>)
          : [];
        const content = candidates[0]?.content as Record<string, unknown> | undefined;
        const parts = Array.isArray(content?.parts)
          ? (content?.parts as Array<Record<string, unknown>>)
          : [];
        const rawText = typeof parts[0]?.text === "string" ? parts[0].text : "[]";
        const parsed = parseExtractedFactsResult(rawText, this.maxFacts);
        if (!parsed.parsed) {
          throw new Error("Gemini extraction returned invalid JSON");
        }
        return parsed.facts;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt < 2) {
          await sleep(250 * 2 ** attempt);
          continue;
        }
      }
    }

    throw lastError ?? new Error("Gemini extraction failed");
  }
}
