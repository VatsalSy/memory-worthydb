import { normalizeWhitespace } from "./text.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function getMessageRole(message: unknown): string | null {
  if (!isRecord(message) || typeof message.role !== "string") {
    return null;
  }
  return message.role;
}

export function extractTextParts(content: unknown): string[] {
  if (typeof content === "string") {
    return [content];
  }

  if (!Array.isArray(content)) {
    return [];
  }

  const parts: string[] = [];
  for (const block of content) {
    if (!isRecord(block)) {
      continue;
    }
    if (block.type === "text" && typeof block.text === "string") {
      parts.push(block.text);
    }
  }
  return parts;
}

export function extractMessageText(message: unknown): string {
  if (!isRecord(message)) {
    return "";
  }
  return normalizeWhitespace(extractTextParts(message.content).join("\n"));
}

export function getLastAssistantText(messages: unknown[]): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (getMessageRole(message) !== "assistant") {
      continue;
    }
    const text = extractMessageText(message);
    if (text) {
      return text;
    }
  }
  return null;
}

export function countUserTurns(messages: unknown[]): number {
  let count = 0;
  for (const message of messages) {
    if (getMessageRole(message) === "user" && extractMessageText(message)) {
      count += 1;
    }
  }
  return count;
}

export function hasSentinelAssistantReply(text: string): boolean {
  const normalized = normalizeWhitespace(text);
  return normalized === "NO_REPLY" || normalized === "HEARTBEAT_OK";
}

export function findLastConversationTurn(
  messages: unknown[],
): { userText: string; assistantText: string } | null {
  let lastUserIndex = -1;
  let userText = "";

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (getMessageRole(messages[index]) !== "user") {
      continue;
    }
    const text = extractMessageText(messages[index]);
    if (!text) {
      continue;
    }
    lastUserIndex = index;
    userText = text;
    break;
  }

  if (lastUserIndex < 0 || !userText) {
    return null;
  }

  const assistantTexts: string[] = [];
  for (let index = lastUserIndex + 1; index < messages.length; index += 1) {
    if (getMessageRole(messages[index]) !== "assistant") {
      continue;
    }
    const text = extractMessageText(messages[index]);
    if (text) {
      assistantTexts.push(text);
    }
  }

  return {
    userText,
    assistantText: normalizeWhitespace(assistantTexts.join("\n\n")),
  };
}
