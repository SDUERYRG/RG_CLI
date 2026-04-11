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

test("QueryEngine interleaves per-turn thinking messages with tool calls", async () => {
  let turn = 0;
  const client: LlmClient = {
    async generateText(_params: GenerateTextParams): Promise<GenerateTextResult> {
      throw new Error("generateText is not used in this test.");
    },
    async generateAssistantTurn(
      _params: GenerateAssistantTurnParams,
    ): Promise<GenerateAssistantTurnResult> {
      throw new Error("blocking fallback should not run");
    },
    async *streamAssistantTurn(
      _params: GenerateAssistantTurnParams,
    ): AsyncGenerator<AssistantTurnStreamEvent, GenerateAssistantTurnResult> {
      turn += 1;

      if (turn === 1) {
        return {
          blocks: [{
            type: "tool_use",
            id: "tool_1",
            name: "missing_tool_1",
            input: {},
          }],
          reasoningSummaries: ["Thought 1"],
          responseId: "resp_1",
        };
      }

      if (turn === 2) {
        return {
          blocks: [{
            type: "tool_use",
            id: "tool_2",
            name: "missing_tool_2",
            input: {},
          }],
          reasoningSummaries: ["Thought 2"],
          responseId: "resp_2",
        };
      }

      return {
        blocks: [{
          type: "text",
          text: "Final answer",
        }],
        responseId: "resp_3",
      };
    },
  };

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

  let finalSession = initialSession;
  for await (const step of engine.submitMessage(initialSession, "hello")) {
    finalSession = step.session;
  }

  const orderedKinds = finalSession.messages
    .filter((message) =>
      message.kind === "tool_call" ||
      message.kind === "thinking" ||
      (message.role === "assistant" &&
        message.kind === undefined &&
        message.content === "Final answer")
    )
    .map((message) => message.kind ?? "assistant");

  expect(orderedKinds).toEqual([
    "tool_call",
    "thinking",
    "tool_call",
    "thinking",
    "assistant",
  ]);
  expect(
    finalSession.messages
      .filter((message) => message.kind === "thinking")
      .map((message) => message.content),
  ).toEqual([
    "思考摘要\nThought 1",
    "思考摘要\nThought 2",
  ]);
  expect(finalSession.lastResponsesResponseId).toBe("resp_3");
});

test("QueryEngine preserves assistant text that accompanies a tool call", async () => {
  let turn = 0;
  const client: LlmClient = {
    async generateText(_params: GenerateTextParams): Promise<GenerateTextResult> {
      throw new Error("generateText is not used in this test.");
    },
    async generateAssistantTurn(
      _params: GenerateAssistantTurnParams,
    ): Promise<GenerateAssistantTurnResult> {
      throw new Error("blocking fallback should not run");
    },
    async *streamAssistantTurn(
      _params: GenerateAssistantTurnParams,
    ): AsyncGenerator<AssistantTurnStreamEvent, GenerateAssistantTurnResult> {
      turn += 1;

      if (turn === 1) {
        return {
          blocks: [
            {
              type: "text",
              text: "Let me inspect that first.",
            },
            {
              type: "tool_use",
              id: "tool_1",
              name: "missing_tool_1",
              input: {},
            },
          ],
          responseId: "resp_1",
        };
      }

      return {
        blocks: [{
          type: "text",
          text: "Final answer",
        }],
        responseId: "resp_2",
      };
    },
  };

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

  let finalSession = initialSession;
  for await (const step of engine.submitMessage(initialSession, "hello")) {
    finalSession = step.session;
  }

  expect(finalSession.messages.map((message) => ({
    role: message.role,
    kind: message.kind ?? "regular",
    content: message.content,
  }))).toEqual([
    {
      role: "assistant",
      kind: "regular",
      content: "你好，我是 RG CLI 助手。你可以先输入一条消息试试看。",
    },
    {
      role: "user",
      kind: "regular",
      content: "hello",
    },
    {
      role: "assistant",
      kind: "regular",
      content: "Let me inspect that first.",
    },
    {
      role: "assistant",
      kind: "tool_call",
      content: "调用工具 missing_tool_1\n输入:\n{}",
    },
    {
      role: "assistant",
      kind: "tool_result",
      content: "工具执行失败\n未找到工具：missing_tool_1",
    },
    {
      role: "assistant",
      kind: "regular",
      content: "Final answer",
    },
  ]);
});
