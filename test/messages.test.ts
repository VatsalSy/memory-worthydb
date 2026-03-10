import { describe, expect, it } from "vitest";
import { findLastConversationTurn, hasSentinelAssistantReply } from "../shared/messages.js";

describe("findLastConversationTurn", () => {
  it("extracts the last user and assistant messages", () => {
    const turn = findLastConversationTurn([
      { role: "user", content: [{ type: "text", text: "First user" }] },
      { role: "assistant", content: [{ type: "text", text: "First assistant" }] },
      { role: "user", content: [{ type: "text", text: "Second user" }] },
      { role: "assistant", content: [{ type: "text", text: "Second assistant" }] },
    ]);

    expect(turn).toEqual({
      userText: "Second user",
      assistantText: "Second assistant",
    });
  });

  it("detects sentinel assistant replies", () => {
    expect(hasSentinelAssistantReply("NO_REPLY")).toBe(true);
    expect(hasSentinelAssistantReply("HEARTBEAT_OK")).toBe(true);
    expect(hasSentinelAssistantReply("Normal response")).toBe(false);
  });
});
