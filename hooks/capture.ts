import type { PluginHookAgentContext } from "openclaw/plugin-sdk";
import { findLastConversationTurn, hasSentinelAssistantReply } from "../shared/messages.js";
import type { WorthyDbConfig } from "../shared/contracts.js";
import type { WorthyDbRuntime } from "../shared/runtime.js";
import { resolveAgentId, resolveSessionKey } from "../shared/runtime.js";

const SKIPPED_PROVIDERS = new Set(["exec-event", "cron-event", "heartbeat"]);
const SKIPPED_SESSION_PATTERN = /(^|:)(cron|cron-agent|isolated)(:|$)/iu;
const SKIPPED_AGENT_IDS = new Set(["cron-agent"]);

export function prepareCaptureTurn(
  event: { messages: unknown[]; success: boolean },
  ctx: PluginHookAgentContext,
  config: WorthyDbConfig,
): { userText: string; assistantText: string } | null {
  if (!event.success || !Array.isArray(event.messages) || event.messages.length === 0) {
    return null;
  }

  if (config.capture.skipCron) {
    const provider = ctx.messageProvider?.toLowerCase();
    if ((provider && SKIPPED_PROVIDERS.has(provider)) || ctx.trigger === "cron" || ctx.trigger === "heartbeat") {
      return null;
    }
    if (ctx.agentId && SKIPPED_AGENT_IDS.has(ctx.agentId)) {
      return null;
    }
    if (ctx.sessionKey && SKIPPED_SESSION_PATTERN.test(ctx.sessionKey)) {
      return null;
    }
  }

  const turn = findLastConversationTurn(event.messages);
  if (!turn || !turn.userText || !turn.assistantText) {
    return null;
  }

  if (config.capture.skipNoReply && hasSentinelAssistantReply(turn.assistantText)) {
    return null;
  }

  const combinedLength = `${turn.userText}\n${turn.assistantText}`.trim().length;
  if (
    combinedLength < config.capture.minTurnChars ||
    combinedLength > config.capture.maxTurnChars
  ) {
    return null;
  }

  return turn;
}

export function buildCaptureHandler(runtime: WorthyDbRuntime) {
  return async (event: { messages: unknown[]; success: boolean }, ctx: PluginHookAgentContext) => {
    try {
      const turn = prepareCaptureTurn(event, ctx, runtime.config);
      if (!turn) {
        return;
      }

      const facts = await runtime.extractor.extractFacts(turn.userText, turn.assistantText);
      if (facts.length === 0) {
        return;
      }

      const agentId = resolveAgentId(ctx);
      const sessionKey = resolveSessionKey(ctx);
      const db = runtime.stores.get(agentId);

      let captured = 0;
      let duplicates = 0;

      const factsWithVectors = await Promise.all(
        facts.map(async (fact) => {
          const vector = await runtime.embeddings.embed(fact.text);
          return { ...fact, vector };
        }),
      );

      const outcomes: Array<"duplicate" | "captured" | "error"> = [];
      for (const fact of factsWithVectors) {
        try {
          const duplicate = await db.findDuplicate(fact.vector, runtime.config.dedup.threshold);
          if (duplicate) {
            outcomes.push("duplicate");
            continue;
          }

          await db.store({
            text: fact.text,
            vector: fact.vector,
            category: fact.category,
            importance: fact.importance,
            agentId,
            sessionKey,
          });
          outcomes.push("captured");
        } catch (error) {
          runtime.logger.warn(`worthydb: failed to capture fact "${fact.text}": ${String(error)}`);
          outcomes.push("error");
        }
      }

      for (const outcome of outcomes) {
        if (outcome === "captured") {
          captured += 1;
        } else if (outcome === "duplicate") {
          duplicates += 1;
        }
      }

      if (captured > 0 || duplicates > 0) {
        runtime.logger.info(
          `worthydb: captured ${captured} facts (${duplicates} skipped as duplicates) for agent ${agentId}`,
        );
      }
    } catch (error) {
      runtime.logger.warn(`worthydb: capture failed: ${String(error)}`);
    }
  };
}
