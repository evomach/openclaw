import { describe, expect, it } from "vitest";
import {
  attachRuntimePromptMediaFacts,
  readRuntimePromptMediaFacts,
} from "../../../media/media-facts.js";
import { castAgentMessage } from "../../test-helpers/agent-message-fixtures.js";
import { normalizeMessagesForLlmBoundary } from "./attempt-llm-boundary.js";

describe("runtime media facts across the LLM boundary", () => {
  it("keeps non-enumerable runtime facts on projected user copies", () => {
    const message = castAgentMessage({
      role: "user",
      content: [{ type: "text", text: "watch the clip" }],
      timestamp: 1_700_000_000_000,
    });
    attachRuntimePromptMediaFacts(message as unknown as object, [
      {
        url: "media://inbound/IMG_TEST.mp4",
        contentType: "video/mp4",
        kind: "video",
      },
    ]);
    const [projected] = normalizeMessagesForLlmBoundary([message], {
      sessionVersion: 4,
      includeTimestamp: true,
      timezone: "UTC",
    });
    const facts = readRuntimePromptMediaFacts(projected as unknown as object);
    expect(facts).toBeDefined();
    expect(facts?.[0]).toMatchObject({ kind: "video", url: "media://inbound/IMG_TEST.mp4" });
  });
});
