export const MEMORY_CATEGORIES = [
  "preference",
  "decision",
  "entity",
  "fact",
  "other",
] as const;

export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number];

export type ExtractedFact = {
  text: string;
  category: MemoryCategory;
  importance: number;
};

export const EXTRACTION_PROVIDERS = ["gemini", "openai", "together"] as const;

export type ExtractionProvider = (typeof EXTRACTION_PROVIDERS)[number];

export type ExtractionProviderConfig = {
  provider: ExtractionProvider;
  apiKey: string;
  model: string;
  baseUrl: string;
  timeoutMs: number;
};

export type MemoryExtractor = {
  extractFacts(userText: string, assistantText: string): Promise<ExtractedFact[]>;
};

export type MemoryEntry = {
  id: string;
  text: string;
  vector: number[];
  category: MemoryCategory;
  importance: number;
  createdAt: number;
  lastHitAt: number;
  hitCount: number;
  agentId: string;
  sessionKey: string;
};

export type MemorySearchResult = {
  entry: MemoryEntry;
  score: number;
};

export type WorthyDbConfig = {
  extraction: {
    maxFacts: number;
    primary: ExtractionProviderConfig;
    fallback: ExtractionProviderConfig;
  };
  embedding: {
    ollamaUrl: string;
    model: string;
    dimensions: number;
    timeoutMs: number;
    keepAlive?: string;
  };
  dbPath: string;
  autoCapture: boolean;
  autoRecall: boolean;
  maxRecallResults: number;
  recallMinScore: number;
  dedup: {
    threshold: number;
  };
  ttl: {
    preference: number;
    decision: number;
    entity: number;
    fact: number;
    other: number;
  };
  capture: {
    skipCron: boolean;
    skipNoReply: boolean;
    minTurnChars: number;
    maxTurnChars: number;
  };
};

export type AgentScopedContext = {
  agentId?: string;
  sessionKey?: string;
  sessionId?: string;
  workspaceDir?: string;
  messageProvider?: string;
  trigger?: string;
  channelId?: string;
};

export type MemoryStats = {
  total: number;
  byCategory: Record<MemoryCategory, number>;
  oldestAt?: number;
  newestAt?: number;
};

export type PruneResult = {
  deleted: number;
  deletedIds: string[];
  dryRun: boolean;
  reason: string;
};
