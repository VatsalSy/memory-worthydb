import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { parseConfig, worthyDbConfigSchema } from "./config.js";
import { MemoryStoreManager } from "./db/store.js";
import { OllamaEmbeddingsClient } from "./embeddings/ollama.js";
import { GeminiExtractionClient } from "./extraction/gemini.js";
import { buildCaptureHandler } from "./hooks/capture.js";
import { buildRecallHandler } from "./hooks/recall.js";
import { pruneStore } from "./prune/prune.js";
import type { MemoryCategory } from "./shared/contracts.js";
import type { WorthyDbRuntime } from "./shared/runtime.js";
import { registerForgetTool } from "./tools/forget.js";
import { registerRecallTool } from "./tools/recall.js";
import { registerStoreTool } from "./tools/store.js";

function parsePositiveInteger(value: unknown, fallback: number): number {
  if (typeof value !== "string") {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function serializeEntries(
  entries: Array<{
    id: string;
    text: string;
    category: MemoryCategory;
    importance: number;
    createdAt: number;
    hitCount: number;
    lastHitAt: number;
  }>,
) {
  return entries.map((entry) => ({
    id: entry.id,
    text: entry.text,
    category: entry.category,
    importance: entry.importance,
    createdAt: entry.createdAt,
    hitCount: entry.hitCount,
    lastHitAt: entry.lastHitAt,
  }));
}

const worthyDbPlugin = {
  id: "memory-worthydb",
  name: "Memory WorthyDB",
  description: "Local-first LLM-extracted long-term memory for OpenClaw",
  kind: "memory" as const,
  configSchema: worthyDbConfigSchema,

  register(api: OpenClawPluginApi) {
    const config = parseConfig(api.pluginConfig);
    const runtime: WorthyDbRuntime = {
      config,
      logger: api.logger,
      stores: new MemoryStoreManager(config, api.resolvePath),
      embeddings: new OllamaEmbeddingsClient(config.embedding, api.logger),
      extractor: new GeminiExtractionClient(config.extraction, api.logger),
    };

    registerRecallTool(api, runtime);
    registerStoreTool(api, runtime);
    registerForgetTool(api, runtime);

    if (config.autoRecall) {
      api.on("before_agent_start", buildRecallHandler(runtime));
    }

    if (config.autoCapture) {
      api.on("agent_end", buildCaptureHandler(runtime));
    }

    api.registerCli(
      ({ program }) => {
        const worthydb = program.command("worthydb").description("memory-worthydb management commands");

        worthydb
          .command("list")
          .description("List memories for an agent")
          .option("--agent <id>", "Agent id", "default")
          .option("--limit <n>", "Maximum results", "20")
          .option("--category <name>", "Filter by category")
          .action(async (opts: { agent: string; limit: string; category?: string }) => {
            const db = runtime.stores.get(opts.agent);
            const entries = await db.all(parsePositiveInteger(opts.limit, 20));
            const filtered =
              typeof opts.category === "string" && opts.category.trim()
                ? entries.filter((entry) => entry.category === opts.category)
                : entries;
            console.log(JSON.stringify(serializeEntries(filtered), null, 2));
          });

        worthydb
          .command("search")
          .description("Search memories")
          .argument("<query>", "Semantic search query")
          .option("--agent <id>", "Agent id", "default")
          .option("--limit <n>", "Maximum results", "5")
          .action(async (query: string, opts: { agent: string; limit: string }) => {
            const db = runtime.stores.get(opts.agent);
            const vector = await runtime.embeddings.embed(query);
            const results = await db.search(vector, {
              limit: parsePositiveInteger(opts.limit, 5),
              minScore: 0.1,
            });
            console.log(
              JSON.stringify(
                results.map((result) => ({
                  id: result.entry.id,
                  text: result.entry.text,
                  category: result.entry.category,
                  importance: result.entry.importance,
                  hitCount: result.entry.hitCount,
                  score: result.score,
                })),
                null,
                2,
              ),
            );
          });

        worthydb
          .command("forget")
          .description("Delete a memory by exact id")
          .argument("<memoryId>", "Memory id")
          .option("--agent <id>", "Agent id", "default")
          .action(async (memoryId: string, opts: { agent: string }) => {
            const db = runtime.stores.get(opts.agent);
            await db.delete(memoryId);
            console.log(JSON.stringify({ deleted: [memoryId] }, null, 2));
          });

        worthydb
          .command("prune")
          .description("Run TTL and/or dedup pruning")
          .option("--agent <id>", "Agent id", "default")
          .option("--dry-run", "Preview deletes without applying them")
          .option("--ttl", "Run TTL pruning")
          .option("--dedup", "Run near-duplicate pruning")
          .action(
            async (opts: {
              agent: string;
              dryRun?: boolean;
              ttl?: boolean;
              dedup?: boolean;
            }) => {
              const db = runtime.stores.get(opts.agent);
              const result = await pruneStore(db, config, {
                dryRun: opts.dryRun === true,
                ttl: opts.ttl === true ? true : opts.dedup === true ? false : true,
                dedup: opts.dedup === true ? true : opts.ttl === true ? false : true,
              });
              console.log(JSON.stringify(result, null, 2));
            },
          );

        worthydb
          .command("stats")
          .description("Show memory statistics for an agent")
          .option("--agent <id>", "Agent id", "default")
          .action(async (opts: { agent: string }) => {
            const db = runtime.stores.get(opts.agent);
            console.log(JSON.stringify(await db.stats(), null, 2));
          });
      },
      { commands: ["worthydb"] },
    );

    api.registerService({
      id: "memory-worthydb",
      start: () => {
        api.logger.info(
          `worthydb: initialized (db template: ${config.dbPath}, embedding model: ${config.embedding.model})`,
        );
        if (!config.extraction.apiKey) {
          api.logger.warn("worthydb: Gemini API key missing; auto-capture extraction will be skipped");
        }
      },
      stop: () => {
        api.logger.info("worthydb: stopped");
      },
    });
  },
};

export default worthyDbPlugin;
