import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import type {
  AssistantTurnStreamEvent,
  GenerateAssistantTurnParams,
  GenerateAssistantTurnResult,
  GenerateTextParams,
  GenerateTextResult,
  LlmClient,
} from "../llm/types.ts";
import { defaultConfig } from "../config/defaults.ts";
import { getCwd, setCwd } from "../shared/cwd.ts";
import { getWelcomeMessage } from "./messages.ts";
import { QueryEngine } from "./QueryEngine.ts";
import type { QueryEngineStep } from "./QueryEngine.ts";
import { createChatSession } from "./storage.ts";

function createStubClient(): LlmClient {
  return {
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
      yield {
        type: "reasoning_delta",
        delta: "Live planning",
      };
      yield {
        type: "output_text_delta",
        delta: "F",
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

function createResponsesEngine(client: LlmClient): QueryEngine {
  return new QueryEngine({
    config: {
      ...defaultConfig,
      llmProvider: "openai-compatible",
      llmWireApi: "responses",
      model: "gpt-5.4",
    },
    client,
  });
}

test("QueryEngine keeps live reasoning out of persisted session snapshots", async () => {
  const engine = createResponsesEngine(createStubClient());
  const initialSession = createChatSession("D:\\test", [getWelcomeMessage()]);

  const steps: QueryEngineStep[] = [];
  let finalSession = initialSession;

  for await (const step of engine.submitMessage(initialSession, "hello")) {
    steps.push(step);
    finalSession = step.session;
  }

  const nonPersistentSteps = steps.filter((step) => !step.persist);
  expect(nonPersistentSteps).toHaveLength(1);
  expect(nonPersistentSteps[0]?.liveThinkingText).toBe("Live planning");
  expect(nonPersistentSteps[0]?.session.messages).toBe(steps[0]?.session.messages);

  const thinkingStepIndex = steps.findIndex((step) =>
    step.persist && step.session.messages.at(-1)?.kind === "thinking"
  );
  const assistantStepIndex = steps.findIndex((step) =>
    step.persist && step.session.messages.at(-1)?.content === "Final answer"
  );
  expect(thinkingStepIndex).toBeGreaterThan(0);
  expect(assistantStepIndex).toBeGreaterThan(thinkingStepIndex);

  const finalThinkingMessages = finalSession.messages.filter((message) =>
    message.kind === "thinking"
  );
  expect(finalThinkingMessages).toHaveLength(1);
  expect(finalThinkingMessages[0]?.content).toContain("Live planning");
  expect(finalSession.lastResponsesResponseId).toBe("resp_final");
  expect(steps.at(-1)?.liveThinkingText).toBeUndefined();
});

test("QueryEngine does not emit an extra combined thinking summary after streamed sections", async () => {
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
      yield {
        type: "reasoning_delta",
        delta: "Alpha",
      };
      yield {
        type: "reasoning_section_break",
      };
      yield {
        type: "reasoning_delta",
        delta: "Beta",
      };
      yield {
        type: "output_text_delta",
        delta: "F",
      };

      return {
        blocks: [{
          type: "text",
          text: "Final answer",
        }],
        reasoningSummaries: ["Alpha", "Beta"],
        responseId: "resp_sections",
      };
    },
  };

  const engine = createResponsesEngine(client);
  const initialSession = createChatSession("D:\\test", [getWelcomeMessage()]);

  let finalSession = initialSession;
  for await (const step of engine.submitMessage(initialSession, "hello")) {
    finalSession = step.session;
  }

  const thinkingContents = finalSession.messages
    .filter((message) => message.kind === "thinking")
    .map((message) => message.content);
  expect(thinkingContents).toHaveLength(2);
  expect(thinkingContents[0]).toContain("Alpha");
  expect(thinkingContents[1]).toContain("Beta");
  expect(thinkingContents.join("\n\n")).not.toContain("Alpha\n\nBeta");
  expect(finalSession.messages.at(-1)?.content).toBe("Final answer");
});

test("QueryEngine surfaces commentary as live progress without persisting it", async () => {
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
      yield {
        type: "commentary_message",
        text: "我先检查关键文件",
      };
      yield {
        type: "output_text_delta",
        delta: "F",
      };

      return {
        blocks: [{
          type: "text",
          text: "Final answer",
        }],
        commentaryTexts: ["我先检查关键文件"],
        responseId: "resp_commentary",
      };
    },
  };

  const engine = createResponsesEngine(client);
  const initialSession = createChatSession("D:\\test", [getWelcomeMessage()]);

  const steps: QueryEngineStep[] = [];
  let finalSession = initialSession;

  for await (const step of engine.submitMessage(initialSession, "hello")) {
    steps.push(step);
    finalSession = step.session;
  }

  const commentaryStep = steps.find((step) =>
    !step.persist && step.liveCommentaryText === "我先检查关键文件"
  );
  expect(commentaryStep).toBeDefined();
  expect(
    finalSession.messages.some((message) => message.content.includes("我先检查关键文件")),
  ).toBe(false);
  expect(finalSession.messages.at(-1)?.content).toBe("Final answer");
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

  const engine = createResponsesEngine(client);
  const initialSession = createChatSession("D:\\test", [getWelcomeMessage()]);

  let finalSession = initialSession;
  for await (const step of engine.submitMessage(initialSession, "hello")) {
    finalSession = step.session;
  }

  const orderedKinds = finalSession.messages
    .filter((message) =>
      message.kind === "tool_call" ||
      message.kind === "tool_result" ||
      message.kind === "thinking" ||
      (message.role === "assistant" &&
        message.kind === undefined &&
        message.content === "Final answer")
    )
    .map((message) => message.kind ?? "assistant");

  expect(orderedKinds).toEqual([
    "thinking",
    "tool_call",
    "tool_result",
    "thinking",
    "tool_call",
    "tool_result",
    "assistant",
  ]);

  const thinkingContents = finalSession.messages
    .filter((message) => message.kind === "thinking")
    .map((message) => message.content);
  expect(thinkingContents).toHaveLength(2);
  expect(thinkingContents[0]).toContain("Thought 1");
  expect(thinkingContents[1]).toContain("Thought 2");
  expect(finalSession.lastResponsesResponseId).toBe("resp_3");
});

test("QueryEngine persists tool calls before their results", async () => {
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

  const engine = createResponsesEngine(client);
  const initialSession = createChatSession("D:\\test", [getWelcomeMessage()]);

  const steps: QueryEngineStep[] = [];
  for await (const step of engine.submitMessage(initialSession, "hello")) {
    steps.push(step);
  }

  const toolCallStepIndex = steps.findIndex((step) =>
    step.persist && step.session.messages.at(-1)?.kind === "tool_call"
  );
  const toolResultStepIndex = steps.findIndex((step) =>
    step.persist && step.session.messages.at(-1)?.kind === "tool_result"
  );
  expect(toolCallStepIndex).toBeGreaterThan(0);
  expect(toolResultStepIndex).toBeGreaterThan(toolCallStepIndex);
});

test("QueryEngine renders multiple tool calls before their streamed results", async () => {
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
              type: "tool_use",
              id: "tool_1",
              name: "missing_tool_1",
              input: {},
            },
            {
              type: "tool_use",
              id: "tool_2",
              name: "missing_tool_2",
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

  const engine = createResponsesEngine(client);
  const initialSession = createChatSession("D:\\test", [getWelcomeMessage()]);

  let finalSession = initialSession;
  for await (const step of engine.submitMessage(initialSession, "hello")) {
    finalSession = step.session;
  }

  const toolMessages = finalSession.messages.filter((message) =>
    message.kind === "tool_call" || message.kind === "tool_result"
  );
  expect(toolMessages.map((message) => message.kind)).toEqual([
    "tool_call",
    "tool_call",
    "tool_result",
    "tool_result",
  ]);
  expect(toolMessages[0]?.content).toContain("missing_tool_1");
  expect(toolMessages[1]?.content).toContain("missing_tool_2");
  expect(toolMessages[2]?.content).toContain("missing_tool_1");
  expect(toolMessages[3]?.content).toContain("missing_tool_2");
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

  const engine = createResponsesEngine(client);
  const welcomeMessage = getWelcomeMessage();
  const initialSession = createChatSession("D:\\test", [welcomeMessage]);

  let finalSession = initialSession;
  for await (const step of engine.submitMessage(initialSession, "hello")) {
    finalSession = step.session;
  }

  expect(finalSession.messages[0]?.content).toBe(welcomeMessage.content);
  expect(finalSession.messages[1]?.content).toBe("hello");
  expect(finalSession.messages[2]?.content).toBe("Let me inspect that first.");
  expect(finalSession.messages[3]?.kind).toBe("tool_call");
  expect(finalSession.messages[3]?.content).toContain("missing_tool_1");
  expect(finalSession.messages[4]?.kind).toBe("tool_result");
  expect(finalSession.messages[4]?.content).toContain("missing_tool_1");
  expect(finalSession.messages[5]?.content).toBe("Final answer");
});

test("QueryEngine renders tool calls inline and truncates tool results to four lines", async () => {
  const originalCwd = getCwd();
  const tempRoot = await mkdtemp(join(process.cwd(), "tmp-rg-cli-query-engine-"));
  const directoryName = "fixture-dir";
  const targetDirectory = join(tempRoot, directoryName);

  try {
    await mkdir(targetDirectory);
    setCwd(tempRoot);

    for (const fileName of [
      "alpha.txt",
      "bravo.txt",
      "charlie.txt",
      "delta.txt",
      "echo.txt",
      "foxtrot.txt",
    ]) {
      await Bun.write(join(targetDirectory, fileName), fileName);
    }

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
              name: "list_directory",
              input: {
                path: directoryName,
              },
            }],
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

    const engine = createResponsesEngine(client);
    const initialSession = createChatSession(tempRoot, [getWelcomeMessage()]);

    let finalSession = initialSession;
    for await (const step of engine.submitMessage(initialSession, "hello")) {
      finalSession = step.session;
    }

    const toolCallContent = finalSession.messages.find((message) =>
      message.kind === "tool_call"
    )?.content;
    expect(toolCallContent).toContain("list_directory");
    expect(toolCallContent).toContain(`"path":"${directoryName}"`);

    const toolResultContent = finalSession.messages.find((message) =>
      message.kind === "tool_result"
    )?.content;
    expect(toolResultContent).toContain(targetDirectory);
    expect(toolResultContent).toContain("[FILE] alpha.txt");
    expect(toolResultContent).toContain("[FILE] bravo.txt");
    expect(toolResultContent).toContain("[FILE] charlie.txt");
    expect(toolResultContent).toContain("3 lines+");
  } finally {
    setCwd(originalCwd);
    await rm(tempRoot, { recursive: true, force: true });
  }
});
