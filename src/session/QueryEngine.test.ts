import { expect, test } from "bun:test";
import type {
  AssistantTurnStreamEvent,
  GenerateAssistantTurnParams,
  GenerateAssistantTurnResult,
  GenerateTextParams,
  GenerateTextResult,
  LlmClient,
} from "../llm/types.ts";
import { defaultConfig } from "../config/defaults.ts";
import { getWelcomeMessage } from "./messages.ts";
import { QueryEngine } from "./QueryEngine.ts";
import { createChatSession } from "./storage.ts";

function createStubClient(): LlmClient {
  return {
    async generateText(_params: GenerateTextParams): Promise<GenerateTextResult> {
      throw new Error("generateText is not used in this test.");
    },
    async generateAssistantTurn(_params: GenerateAssistantTurnParams): Promise<GenerateAssistantTurnResult> {
      throw new Error("blocking fallback should not run");
    },
    async *streamAssistantTurn(
      _params: GenerateAssistantTurnParams,
    ): AsyncGenerator<AssistantTurnStreamEvent, GenerateAssistantTurnResult> {
      yield {
        type: "reasoning_delta",
        delta: "Live planning",
      };

      return {
        blocks: [{
          type: "text",
          text: "Final answer",
        }],
        reasoningSummaries: ["Live planning"],
        responseId: "resp_final",
      };
    },
  };
}

test("QueryEngine keeps live reasoning out of persisted session snapshots", async () => {
  const client = createStubClient();
  const engine = new QueryEngine({
    config: {
      ...defaultConfig,
      llmProvider: "openai-compatible",
      llmWireApi: "responses",
      model: "gpt-5.4",
    },
    client,
  });
  const initialSession = createChatSession("D:\\test", [getWelcomeMessage()]);

  const steps = [];
  let finalSession = initialSession;

  for await (const step of engine.submitMessage(initialSession, "hello")) {
    steps.push(step);
    finalSession = step.session;
  }

  const nonPersistentSteps = steps.filter((step) => !step.persist);
  expect(nonPersistentSteps).toHaveLength(1);
  expect(nonPersistentSteps[0]?.liveThinkingText).toBe("Live planning");

  const persistentStepsBeforeFinal = steps.filter((step, index) =>
    step.persist && index < steps.length - 1
  );
  for (const step of persistentStepsBeforeFinal) {
    expect(step.session.messages.some((message) => message.kind === "thinking")).toBe(false);
  }

  const finalThinkingMessages = finalSession.messages.filter((message) =>
    message.kind === "thinking"
  );
  expect(finalThinkingMessages).toHaveLength(1);
  expect(finalThinkingMessages[0]?.content).toBe("思考摘要\nLive planning");
  expect(finalSession.lastResponsesResponseId).toBe("resp_final");
  expect(steps.at(-1)?.liveThinkingText).toBeUndefined();
});
