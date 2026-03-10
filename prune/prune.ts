import type { MemoryDB } from "../db/store.js";
import type { MemoryEntry, PruneResult, WorthyDbConfig } from "../shared/contracts.js";
import { cosineSimilarity } from "../shared/text.js";

function ttlDaysForEntry(entry: MemoryEntry, config: WorthyDbConfig["ttl"]): number {
  return config[entry.category];
}

function compareRetentionPriority(left: MemoryEntry, right: MemoryEntry): number {
  if (right.importance !== left.importance) {
    return right.importance - left.importance;
  }
  if (right.hitCount !== left.hitCount) {
    return right.hitCount - left.hitCount;
  }
  if (right.lastHitAt !== left.lastHitAt) {
    return right.lastHitAt - left.lastHitAt;
  }
  return right.createdAt - left.createdAt;
}

export function shouldExpireEntry(
  entry: MemoryEntry,
  config: WorthyDbConfig["ttl"],
  now = Date.now(),
): boolean {
  const ttlDays = ttlDaysForEntry(entry, config);
  if (ttlDays === 0) {
    return false;
  }

  const ttlMs = ttlDays * 24 * 60 * 60 * 1000;
  const ageMs = now - entry.createdAt;
  const lastHitAgeMs = entry.lastHitAt > 0 ? now - entry.lastHitAt : ageMs;

  return (entry.hitCount === 0 && ageMs >= ttlMs) || ageMs >= ttlMs * 2 || lastHitAgeMs >= ttlMs * 2;
}

export async function pruneTtl(
  db: MemoryDB,
  config: WorthyDbConfig,
  options: { dryRun?: boolean; now?: number } = {},
): Promise<PruneResult> {
  const entries = await db.all();
  const now = options.now ?? Date.now();
  const deletedIds = entries
    .filter((entry) => shouldExpireEntry(entry, config.ttl, now))
    .map((entry) => entry.id);

  if (!options.dryRun) {
    await db.deleteMany(deletedIds);
  }

  return {
    deleted: deletedIds.length,
    deletedIds,
    dryRun: options.dryRun === true,
    reason: "ttl",
  };
}

export async function pruneNearDuplicates(
  db: MemoryDB,
  config: WorthyDbConfig,
  options: { dryRun?: boolean; minSimilarity?: number } = {},
): Promise<PruneResult> {
  const entries = await db.all();
  const visited = new Set<string>();
  const deletedIds: string[] = [];
  const effectiveThreshold = Math.min(0.94, Math.max(0.8, options.minSimilarity ?? 0.8));

  for (const entry of entries) {
    if (visited.has(entry.id)) {
      continue;
    }

    const cluster = [entry];
    visited.add(entry.id);

    for (const candidate of entries) {
      if (candidate.id === entry.id || visited.has(candidate.id)) {
        continue;
      }
      const similarity = cosineSimilarity(entry.vector, candidate.vector);
      if (similarity >= effectiveThreshold) {
        visited.add(candidate.id);
        cluster.push(candidate);
      }
    }

    if (cluster.length <= 1) {
      continue;
    }

    cluster.sort(compareRetentionPriority);
    for (const duplicate of cluster.slice(1)) {
      deletedIds.push(duplicate.id);
    }
  }

  if (!options.dryRun) {
    await db.deleteMany(deletedIds);
  }

  return {
    deleted: deletedIds.length,
    deletedIds,
    dryRun: options.dryRun === true,
    reason: "dedup",
  };
}

export async function pruneStore(
  db: MemoryDB,
  config: WorthyDbConfig,
  options: {
    dryRun?: boolean;
    ttl?: boolean;
    dedup?: boolean;
    minSimilarity?: number;
  } = {},
): Promise<PruneResult> {
  const dryRun = options.dryRun === true;
  const deletedIds = new Set<string>();

  if (options.ttl !== false) {
    const ttlResult = await pruneTtl(db, config, { dryRun });
    for (const id of ttlResult.deletedIds) {
      deletedIds.add(id);
    }
  }

  if (options.dedup !== false) {
    const dedupResult = await pruneNearDuplicates(db, config, {
      dryRun,
      minSimilarity: options.minSimilarity,
    });
    for (const id of dedupResult.deletedIds) {
      deletedIds.add(id);
    }
  }

  return {
    deleted: deletedIds.size,
    deletedIds: [...deletedIds],
    dryRun,
    reason: "combined",
  };
}
