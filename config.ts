import fs from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { OpenClawPluginConfigSchema, PluginConfigUiHint } from "openclaw/plugin-sdk";
import type { WorthyDbConfig } from "./shared/contracts.js";
import { clamp } from "./shared/text.js";

const DEFAULT_DB_PATH = "~/.openclaw/memory/worthydb/{agentId}";

const DEFAULTS: WorthyDbConfig = {
  extraction: {
    apiKey: "",
    model: "gemini-2.5-flash-lite",
    maxFacts: 5,
    timeoutMs: 8000,
  },
  embedding: {
    ollamaUrl: "http://localhost:11434",
    model: "qwen3-embedding:latest",
    dimensions: 4096,
    timeoutMs: 5000,
  },
  dbPath: DEFAULT_DB_PATH,
  autoCapture: true,
  autoRecall: true,
  maxRecallResults: 8,
  recallMinScore: 0.45,
  dedup: {
    threshold: 0.95,
  },
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

const UI_HINTS: Record<string, PluginConfigUiHint> = {
  "extraction.apiKey": {
    label: "Gemini API Key",
    sensitive: true,
    placeholder: "${GEMINI_API_KEY}",
    help: "Gemini API key used for durable fact extraction.",
  },
  "extraction.model": {
    label: "Gemini Model",
    placeholder: DEFAULTS.extraction.model,
    help: "Gemini model used for extraction.",
  },
  "extraction.maxFacts": {
    label: "Max Extracted Facts",
    placeholder: String(DEFAULTS.extraction.maxFacts),
    help: "Maximum number of atomic memories extracted from a turn.",
    advanced: true,
  },
  "extraction.timeoutMs": {
    label: "Extraction Timeout",
    placeholder: String(DEFAULTS.extraction.timeoutMs),
    help: "Gemini request timeout in milliseconds.",
    advanced: true,
  },
  "embedding.ollamaUrl": {
    label: "Ollama URL",
    placeholder: DEFAULTS.embedding.ollamaUrl,
    help: "Base URL for the local Ollama server.",
  },
  "embedding.model": {
    label: "Embedding Model",
    placeholder: DEFAULTS.embedding.model,
    help: "Ollama embedding model used for storage and recall.",
  },
  "embedding.dimensions": {
    label: "Embedding Dimensions",
    placeholder: String(DEFAULTS.embedding.dimensions),
    help: "Expected embedding dimension for the selected Ollama model.",
    advanced: true,
  },
  "embedding.timeoutMs": {
    label: "Embedding Timeout",
    placeholder: String(DEFAULTS.embedding.timeoutMs),
    help: "Ollama request timeout in milliseconds.",
    advanced: true,
  },
  dbPath: {
    label: "Database Path",
    placeholder: DEFAULT_DB_PATH,
    help: "LanceDB path template. Use {agentId} for agent-scoped isolation.",
    advanced: true,
  },
  autoCapture: {
    label: "Auto-Capture",
    help: "Automatically extract durable memory facts after each successful turn.",
  },
  autoRecall: {
    label: "Auto-Recall",
    help: "Automatically inject relevant memories before each turn.",
  },
  maxRecallResults: {
    label: "Max Recall Results",
    placeholder: String(DEFAULTS.maxRecallResults),
    help: "Maximum memories injected or returned by recall.",
    advanced: true,
  },
  recallMinScore: {
    label: "Recall Min Score",
    placeholder: "0.45",
    help: "Minimum cosine similarity (0–1) for a memory to be injected. Higher = stricter relevance.",
    advanced: true,
  },
  "dedup.threshold": {
    label: "Dedup Threshold",
    placeholder: String(DEFAULTS.dedup.threshold),
    help: "Cosine similarity threshold used to reject duplicate memories.",
    advanced: true,
  },
  "ttl.preference": {
    label: "Preference TTL (days)",
    placeholder: String(DEFAULTS.ttl.preference),
    help: "Days before unrecalled preferences can expire. Use 0 to keep forever.",
    advanced: true,
  },
  "ttl.decision": {
    label: "Decision TTL (days)",
    placeholder: String(DEFAULTS.ttl.decision),
    help: "Days before unrecalled decisions can expire.",
    advanced: true,
  },
  "ttl.entity": {
    label: "Entity TTL (days)",
    placeholder: String(DEFAULTS.ttl.entity),
    help: "Days before entity memories can expire. 0 disables expiry.",
    advanced: true,
  },
  "ttl.fact": {
    label: "Fact TTL (days)",
    placeholder: String(DEFAULTS.ttl.fact),
    help: "Days before unrecalled facts can expire.",
    advanced: true,
  },
  "ttl.other": {
    label: "Other TTL (days)",
    placeholder: String(DEFAULTS.ttl.other),
    help: "Days before unrecalled miscellaneous memories can expire.",
    advanced: true,
  },
  "capture.skipCron": {
    label: "Skip Cron Sessions",
    help: "Do not capture from cron, isolated, or non-chat sessions.",
    advanced: true,
  },
  "capture.skipNoReply": {
    label: "Skip Sentinels",
    help: "Ignore NO_REPLY and HEARTBEAT_OK assistant outputs.",
    advanced: true,
  },
  "capture.minTurnChars": {
    label: "Min Turn Chars",
    placeholder: String(DEFAULTS.capture.minTurnChars),
    help: "Minimum combined user/assistant text length eligible for extraction.",
    advanced: true,
  },
  "capture.maxTurnChars": {
    label: "Max Turn Chars",
    placeholder: String(DEFAULTS.capture.maxTurnChars),
    help: "Maximum combined user/assistant text length sent to extraction.",
    advanced: true,
  },
};

const JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    extraction: {
      type: "object",
      additionalProperties: false,
      properties: {
        apiKey: { type: "string" },
        model: { type: "string" },
        maxFacts: { type: "number", minimum: 1, maximum: 10 },
        timeoutMs: { type: "number", minimum: 1000, maximum: 60000 },
      },
    },
    embedding: {
      type: "object",
      additionalProperties: false,
      properties: {
        ollamaUrl: { type: "string" },
        model: { type: "string" },
        dimensions: { type: "number", minimum: 1, maximum: 16384 },
        timeoutMs: { type: "number", minimum: 1000, maximum: 60000 },
      },
    },
    dbPath: { type: "string" },
    autoCapture: { type: "boolean" },
    autoRecall: { type: "boolean" },
    maxRecallResults: { type: "number", minimum: 1, maximum: 20 },
    recallMinScore: { type: "number", minimum: 0, maximum: 1 },
    dedup: {
      type: "object",
      additionalProperties: false,
      properties: {
        threshold: { type: "number", minimum: 0.5, maximum: 0.9999 },
      },
    },
    ttl: {
      type: "object",
      additionalProperties: false,
      properties: {
        preference: { type: "number", minimum: 0, maximum: 3650 },
        decision: { type: "number", minimum: 0, maximum: 3650 },
        entity: { type: "number", minimum: 0, maximum: 3650 },
        fact: { type: "number", minimum: 0, maximum: 3650 },
        other: { type: "number", minimum: 0, maximum: 3650 },
      },
    },
    capture: {
      type: "object",
      additionalProperties: false,
      properties: {
        skipCron: { type: "boolean" },
        skipNoReply: { type: "boolean" },
        minTurnChars: { type: "number", minimum: 1, maximum: 10000 },
        maxTurnChars: { type: "number", minimum: 1, maximum: 20000 },
      },
    },
  },
};

let envFileCache: Map<string, string> | null = null;

function assertAllowedKeys(value: Record<string, unknown>, allowed: string[], label: string): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    throw new Error(`${label} has unknown keys: ${unknown.join(", ")}`);
  }
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function loadOpenClawEnvFile(): Map<string, string> {
  if (envFileCache) {
    return envFileCache;
  }

  const values = new Map<string, string>();
  const filePath = path.join(homedir(), ".openclaw", ".env");

  try {
    const content = fs.readFileSync(filePath, "utf8");
    for (const rawLine of content.split(/\r?\n/u)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) {
        continue;
      }
      const normalized = line.startsWith("export ") ? line.slice(7) : line;
      const separatorIndex = normalized.indexOf("=");
      if (separatorIndex <= 0) {
        continue;
      }
      const key = normalized.slice(0, separatorIndex).trim();
      let value = normalized.slice(separatorIndex + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (key) {
        values.set(key, value);
      }
    }
  } catch {
    // Best-effort only.
  }

  envFileCache = values;
  return values;
}

export function clearEnvFileCache(): void {
  envFileCache = null;
}

function getEnvValue(name: string): string | undefined {
  const processValue = process.env[name];
  if (processValue && processValue.length > 0) {
    return processValue;
  }
  return loadOpenClawEnvFile().get(name);
}

function resolveEnvPlaceholders(value: string, throwOnMissing = true): string {
  return value.replace(/\$\{([^}]+)\}/g, (_match, envVar: string) => {
    const resolved = getEnvValue(envVar);
    if (!resolved) {
      if (throwOnMissing) {
        throw new Error(`Environment variable ${envVar} is not set`);
      }
      return "";
    }
    return resolved;
  });
}

function resolveConfigString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? resolveEnvPlaceholders(value.trim()) : fallback;
}

function resolveGeminiApiKey(value: unknown): string {
  if (typeof value === "string" && value.trim()) {
    return resolveEnvPlaceholders(value.trim(), false);
  }
  return getEnvValue("GEMINI_API_KEY") ?? "";
}

function resolveInteger(value: unknown, fallback: number, min: number, max: number, label: string): number {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a number`);
  }
  const normalized = Math.floor(value);
  if (normalized < min || normalized > max) {
    throw new Error(`${label} must be between ${min} and ${max}`);
  }
  return normalized;
}

function resolveBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export function parseConfig(value: unknown): WorthyDbConfig {
  const cfg =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};

  if (Object.keys(cfg).length > 0) {
    assertAllowedKeys(
      cfg,
      [
        "extraction",
        "embedding",
        "dbPath",
        "autoCapture",
        "autoRecall",
        "maxRecallResults",
        "recallMinScore",
        "dedup",
        "ttl",
        "capture",
      ],
      "worthydb config",
    );
  }

  const extraction = cfg.extraction ? asRecord(cfg.extraction, "extraction") : {};
  const embedding = cfg.embedding ? asRecord(cfg.embedding, "embedding") : {};
  const dedup = cfg.dedup ? asRecord(cfg.dedup, "dedup") : {};
  const ttl = cfg.ttl ? asRecord(cfg.ttl, "ttl") : {};
  const capture = cfg.capture ? asRecord(cfg.capture, "capture") : {};

  assertAllowedKeys(extraction, ["apiKey", "model", "maxFacts", "timeoutMs"], "extraction");
  assertAllowedKeys(embedding, ["ollamaUrl", "model", "dimensions", "timeoutMs"], "embedding");
  assertAllowedKeys(dedup, ["threshold"], "dedup");
  assertAllowedKeys(ttl, ["preference", "decision", "entity", "fact", "other"], "ttl");
  assertAllowedKeys(capture, ["skipCron", "skipNoReply", "minTurnChars", "maxTurnChars"], "capture");

  const parsed: WorthyDbConfig = {
    extraction: {
      apiKey: resolveGeminiApiKey(extraction.apiKey),
      model: resolveConfigString(extraction.model, DEFAULTS.extraction.model),
      maxFacts: resolveInteger(
        extraction.maxFacts,
        DEFAULTS.extraction.maxFacts,
        1,
        10,
        "extraction.maxFacts",
      ),
      timeoutMs: resolveInteger(
        extraction.timeoutMs,
        DEFAULTS.extraction.timeoutMs,
        1000,
        60000,
        "extraction.timeoutMs",
      ),
    },
    embedding: {
      ollamaUrl: resolveConfigString(embedding.ollamaUrl, DEFAULTS.embedding.ollamaUrl),
      model: resolveConfigString(embedding.model, DEFAULTS.embedding.model),
      dimensions: resolveInteger(
        embedding.dimensions,
        DEFAULTS.embedding.dimensions,
        1,
        16384,
        "embedding.dimensions",
      ),
      timeoutMs: resolveInteger(
        embedding.timeoutMs,
        DEFAULTS.embedding.timeoutMs,
        1000,
        60000,
        "embedding.timeoutMs",
      ),
    },
    dbPath: resolveConfigString(cfg.dbPath, DEFAULTS.dbPath),
    autoCapture: resolveBoolean(cfg.autoCapture, DEFAULTS.autoCapture),
    autoRecall: resolveBoolean(cfg.autoRecall, DEFAULTS.autoRecall),
    maxRecallResults: resolveInteger(
      cfg.maxRecallResults,
      DEFAULTS.maxRecallResults,
      1,
      20,
      "maxRecallResults",
    ),
    recallMinScore: clamp(
      typeof cfg.recallMinScore === "number" ? cfg.recallMinScore : DEFAULTS.recallMinScore,
      0,
      1,
    ),
    dedup: {
      threshold:
        typeof dedup.threshold === "number"
          ? clamp(dedup.threshold, 0.5, 0.9999)
          : DEFAULTS.dedup.threshold,
    },
    ttl: {
      preference: resolveInteger(ttl.preference, DEFAULTS.ttl.preference, 0, 3650, "ttl.preference"),
      decision: resolveInteger(ttl.decision, DEFAULTS.ttl.decision, 0, 3650, "ttl.decision"),
      entity: resolveInteger(ttl.entity, DEFAULTS.ttl.entity, 0, 3650, "ttl.entity"),
      fact: resolveInteger(ttl.fact, DEFAULTS.ttl.fact, 0, 3650, "ttl.fact"),
      other: resolveInteger(ttl.other, DEFAULTS.ttl.other, 0, 3650, "ttl.other"),
    },
    capture: {
      skipCron: resolveBoolean(capture.skipCron, DEFAULTS.capture.skipCron),
      skipNoReply: resolveBoolean(capture.skipNoReply, DEFAULTS.capture.skipNoReply),
      minTurnChars: resolveInteger(
        capture.minTurnChars,
        DEFAULTS.capture.minTurnChars,
        1,
        10000,
        "capture.minTurnChars",
      ),
      maxTurnChars: resolveInteger(
        capture.maxTurnChars,
        DEFAULTS.capture.maxTurnChars,
        1,
        20000,
        "capture.maxTurnChars",
      ),
    },
  };

  if (parsed.capture.minTurnChars > parsed.capture.maxTurnChars) {
    throw new Error("capture.minTurnChars cannot exceed capture.maxTurnChars");
  }

  return parsed;
}

export function resolveDbPathForAgent(
  dbPathTemplate: string,
  agentId: string,
  resolvePath: (input: string) => string,
): string {
  const safeAgentId = agentId.replace(/[^a-zA-Z0-9._-]/g, "_") || "default";
  return resolvePath(dbPathTemplate.replaceAll("{agentId}", safeAgentId));
}

export const worthyDbConfigSchema: OpenClawPluginConfigSchema = {
  parse: parseConfig,
  safeParse(value: unknown) {
    try {
      return { success: true, data: parseConfig(value) };
    } catch (error) {
      return {
        success: false,
        error: {
          issues: [{ path: [], message: error instanceof Error ? error.message : String(error) }],
        },
      };
    }
  },
  uiHints: UI_HINTS,
  jsonSchema: JSON_SCHEMA,
};

export const worthyDbUiHints = UI_HINTS;
export const worthyDbJsonSchema = JSON_SCHEMA;
