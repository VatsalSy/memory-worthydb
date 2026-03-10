import { MEMORY_CATEGORIES, type MemoryCategory } from "./contracts.js";

const PROMPT_INJECTION_PATTERNS = [
  /ignore (all|any|previous|above|prior) instructions/i,
  /do not follow (the )?(system|developer)/i,
  /system prompt/i,
  /developer message/i,
  /<\s*(system|assistant|developer|tool|function|relevant-memories|worthydb-context)\b/i,
  /\b(run|execute|call|invoke)\b.{0,40}\b(tool|command)\b/i,
];

const PROMPT_ESCAPE_MAP: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}

export function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function sanitizeMemoryText(text: string, maxLength = 500): string {
  const trimmed = normalizeWhitespace(text).replace(/^[-*]\s+/, "");
  return trimmed.slice(0, maxLength).trim();
}

export function looksLikePromptInjection(text: string): boolean {
  const normalized = normalizeWhitespace(text);
  if (!normalized) {
    return false;
  }
  return PROMPT_INJECTION_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function escapeMemoryForPrompt(text: string): string {
  return text.replace(/[&<>"']/g, (char) => PROMPT_ESCAPE_MAP[char] ?? char);
}

export function detectMemoryCategory(text: string): MemoryCategory {
  const lower = text.toLowerCase();
  if (/prefer|preference|like|love|hate|favorite|avoid|want/i.test(lower)) {
    return "preference";
  }
  if (/decided|decision|going with|will use|we will|plan is/i.test(lower)) {
    return "decision";
  }
  if (
    /\+\d{7,}|@[\w.-]+\.\w+|\bname\s+is\b|\b(?:my|our|his|her|their)\s+\w+\s+is\s+called\s+\w+\b|\b(?:wife|husband|partner|friend|dog|cat|son|daughter)\s+is\s+called\s+\w+\b|wife|husband|address/i.test(
      lower,
    )
  ) {
    return "entity";
  }
  if (/\bis\b|\bare\b|\bhas\b|\bhave\b|\buses\b|\bworks\b/i.test(lower)) {
    return "fact";
  }
  return "other";
}

export function isMemoryCategory(value: unknown): value is MemoryCategory {
  return typeof value === "string" && MEMORY_CATEGORIES.includes(value as MemoryCategory);
}

export function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length === 0 || right.length === 0 || left.length !== right.length) {
    return 0;
  }

  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;

  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    dot += leftValue * rightValue;
    leftMagnitude += leftValue * leftValue;
    rightMagnitude += rightValue * rightValue;
  }

  if (leftMagnitude === 0 || rightMagnitude === 0) {
    return 0;
  }

  return dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
}

export function uniqueByNormalizedText<T extends { text: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const unique: T[] = [];

  for (const item of items) {
    const key = normalizeWhitespace(item.text).toLowerCase();
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(item);
  }

  return unique;
}
