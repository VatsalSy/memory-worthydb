import { randomUUID } from "node:crypto";
import fs from "node:fs";
import type * as LanceDB from "@lancedb/lancedb";
import { resolveDbPathForAgent } from "../config.js";
import type {
  MemoryEntry,
  MemorySearchResult,
  MemoryStats,
  WorthyDbConfig,
} from "../shared/contracts.js";
import { cosineSimilarity } from "../shared/text.js";

const TABLE_NAME = "memories";
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

let lancedbImportPromise: Promise<typeof import("@lancedb/lancedb")> | null = null;

async function loadLanceDb(): Promise<typeof import("@lancedb/lancedb")> {
  if (!lancedbImportPromise) {
    lancedbImportPromise = import("@lancedb/lancedb");
  }
  try {
    return await lancedbImportPromise;
  } catch (error) {
    throw new Error(`worthydb: failed to load LanceDB: ${String(error)}`, { cause: error });
  }
}

function escapeSqlString(value: string): string {
  return value.replaceAll("'", "''");
}

function toNumberArray(value: unknown): number[] {
  if (Array.isArray(value)) {
    return value.map((item) => Number(item));
  }
  if (ArrayBuffer.isView(value)) {
    const typedArray = value as unknown as { length: number; [index: number]: number };
    return Array.from({ length: typedArray.length }, (_item, index) => Number(typedArray[index] ?? 0));
  }
  return [];
}

function rowToEntry(row: Record<string, unknown>): MemoryEntry {
  return {
    id: String(row.id ?? ""),
    text: String(row.text ?? ""),
    vector: toNumberArray(row.vector),
    category: String(row.category ?? "other") as MemoryEntry["category"],
    importance: Number(row.importance ?? 0),
    createdAt: Number(row.createdAt ?? 0),
    lastHitAt: Number(row.lastHitAt ?? 0),
    hitCount: Number(row.hitCount ?? 0),
    agentId: String(row.agentId ?? "default"),
    sessionKey: String(row.sessionKey ?? ""),
  };
}

export class MemoryDB {
  private db: LanceDB.Connection | null = null;
  private table: LanceDB.Table | null = null;
  private initPromise: Promise<void> | null = null;

  constructor(
    private readonly dbPath: string,
    private readonly vectorDim: number,
  ) {}

  private async ensureInitialized(): Promise<void> {
    if (this.table) {
      return;
    }
    if (this.initPromise) {
      return this.initPromise;
    }
    this.initPromise = this.doInitialize().catch((error) => {
      this.initPromise = null;
      throw error;
    });
    return this.initPromise;
  }

  private async doInitialize(): Promise<void> {
    fs.mkdirSync(this.dbPath, { recursive: true });
    const lancedb = await loadLanceDb();
    this.db = await lancedb.connect(this.dbPath);

    const tableNames = await this.db.tableNames();
    if (tableNames.includes(TABLE_NAME)) {
      this.table = await this.db.openTable(TABLE_NAME);
      return;
    }

    this.table = await this.db.createTable(TABLE_NAME, [
      {
        id: "__schema__",
        text: "",
        vector: Array.from({ length: this.vectorDim }, () => 0),
        category: "other",
        importance: 0,
        createdAt: 0,
        lastHitAt: 0,
        hitCount: 0,
        agentId: "default",
        sessionKey: "",
      },
    ]);
    await this.table.delete('id = "__schema__"');
  }

  async store(
    entry: Omit<MemoryEntry, "id" | "createdAt" | "lastHitAt" | "hitCount"> &
      Partial<Pick<MemoryEntry, "id" | "createdAt" | "lastHitAt" | "hitCount">>,
  ): Promise<MemoryEntry> {
    await this.ensureInitialized();

    if (entry.vector.length !== this.vectorDim) {
      throw new Error(
        `worthydb: embedding dimension mismatch. Expected ${this.vectorDim}, got ${entry.vector.length}`,
      );
    }

    const fullEntry: MemoryEntry = {
      ...entry,
      id: entry.id ?? randomUUID(),
      createdAt: entry.createdAt ?? Date.now(),
      lastHitAt: entry.lastHitAt ?? 0,
      hitCount: entry.hitCount ?? 0,
    };

    await this.table!.add([fullEntry]);
    return fullEntry;
  }

  async search(
    vector: number[],
    options: {
      limit?: number;
      minScore?: number;
      candidateLimit?: number;
    } = {},
  ): Promise<MemorySearchResult[]> {
    await this.ensureInitialized();

    const limit = Math.max(1, options.limit ?? 5);
    const minScore = options.minScore ?? 0;
    const candidateLimit = Math.max(limit, options.candidateLimit ?? Math.max(limit * 5, 12));

    let query: any = this.table!.vectorSearch(vector);
    if (typeof query.distanceType === "function") {
      query = query.distanceType("cosine");
    }
    if (typeof query.limit === "function") {
      query = query.limit(candidateLimit);
    }

    const rows = (await query.toArray()) as Array<Record<string, unknown>>;

    return rows
      .map((row) => {
        const entry = rowToEntry(row);
        return {
          entry,
          score: cosineSimilarity(vector, entry.vector),
        };
      })
      .filter((result) => result.entry.id && result.score >= minScore)
      .sort((left, right) => right.score - left.score)
      .slice(0, limit);
  }

  async findDuplicate(vector: number[], threshold: number): Promise<MemorySearchResult | null> {
    const results = await this.search(vector, {
      limit: 1,
      minScore: threshold,
      candidateLimit: 10,
    });
    return results[0] ?? null;
  }

  async all(limit?: number): Promise<MemoryEntry[]> {
    await this.ensureInitialized();

    let query: any = this.table!.query();
    if (typeof limit === "number") {
      query = query.limit(limit);
    }

    const rows = (await query.toArray()) as Array<Record<string, unknown>>;
    return rows
      .map(rowToEntry)
      .filter((entry) => entry.id && entry.id !== "__schema__")
      .sort((left, right) => right.createdAt - left.createdAt);
  }

  async getById(id: string): Promise<MemoryEntry | null> {
    await this.ensureInitialized();
    if (!UUID_REGEX.test(id)) {
      throw new Error(`worthydb: invalid memory id: ${id}`);
    }

    let query: any = this.table!.query();
    if (typeof query.where === "function") {
      query = query.where(`id = '${escapeSqlString(id)}'`);
    }
    if (typeof query.limit === "function") {
      query = query.limit(1);
    }

    const rows = (await query.toArray()) as Array<Record<string, unknown>>;
    const entry = rows.map(rowToEntry).find((candidate) => candidate.id && candidate.id !== "__schema__");
    return entry ?? null;
  }

  async delete(id: string): Promise<boolean> {
    await this.ensureInitialized();
    if (!UUID_REGEX.test(id)) {
      throw new Error(`worthydb: invalid memory id: ${id}`);
    }
    await this.table!.delete(`id = '${escapeSqlString(id)}'`);
    return true;
  }

  async deleteMany(ids: string[]): Promise<number> {
    await this.ensureInitialized();
    const validIds = ids.filter((id) => UUID_REGEX.test(id));
    if (validIds.length === 0) {
      return 0;
    }
    const clause = validIds.map((id) => `id = '${escapeSqlString(id)}'`).join(" OR ");
    await this.table!.delete(clause);
    return validIds.length;
  }

  async touch(entries: MemoryEntry[], now = Date.now()): Promise<void> {
    await this.ensureInitialized();
    await Promise.all(
      entries.map(async (entry) => {
        if (!UUID_REGEX.test(entry.id)) {
          return;
        }
        await this.table!.update({
          where: `id = '${escapeSqlString(entry.id)}'`,
          values: {
            lastHitAt: now,
            hitCount: Math.max(0, entry.hitCount) + 1,
          },
        });
      }),
    );
  }

  async count(): Promise<number> {
    await this.ensureInitialized();
    return this.table!.countRows();
  }

  async stats(): Promise<MemoryStats> {
    const entries = await this.all();
    const byCategory: MemoryStats["byCategory"] = {
      preference: 0,
      decision: 0,
      entity: 0,
      fact: 0,
      other: 0,
    };

    for (const entry of entries) {
      byCategory[entry.category] += 1;
    }

    const createdAtValues = entries.map((entry) => entry.createdAt).filter((value) => value > 0);

    return {
      total: entries.length,
      byCategory,
      oldestAt: createdAtValues.length > 0 ? Math.min(...createdAtValues) : undefined,
      newestAt: createdAtValues.length > 0 ? Math.max(...createdAtValues) : undefined,
    };
  }
}

export class MemoryStoreManager {
  private readonly stores = new Map<string, MemoryDB>();

  constructor(
    private readonly config: Pick<WorthyDbConfig, "dbPath" | "embedding">,
    private readonly resolvePath: (input: string) => string,
  ) {}

  get(agentId: string): MemoryDB {
    const normalizedAgentId = agentId.trim() || "default";
    const cached = this.stores.get(normalizedAgentId);
    if (cached) {
      return cached;
    }

    const dbPath = resolveDbPathForAgent(this.config.dbPath, normalizedAgentId, this.resolvePath);
    const db = new MemoryDB(dbPath, this.config.embedding.dimensions);
    this.stores.set(normalizedAgentId, db);
    return db;
  }
}
