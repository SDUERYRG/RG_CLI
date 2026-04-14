import { expect, test } from "bun:test";
import type {
  AssistantTurnStreamEvent,
  GenerateAssistantTurnParams,
  GenerateAssistantTurnResult,
  GenerateTextParams,
  GenerateTextResult,
  LlmClient,
} from "../llm/types.ts";
import { query, type QueryResult, type QueryUpdate } from "./query.ts";

function createStubClient(options: {
  generateAssistantTurn?: (params: GenerateAssistantTurnParams) => Promise<GenerateAssistantTurnResult>;
  streamAssistantTurn?: (
    params: GenerateAssistantTurnParams,
  ) => AsyncGenerator<AssistantTurnStreamEvent, GenerateAssistantTurnResult>;
}): LlmClient {
  return {
    async generateText(_params: GenerateTextParams): Promise<GenerateTextResult> {
      throw new Error("generateText is not used in this test.");
    },
    async generateAssistantTurn(params: GenerateAssistantTurnParams): Promise<GenerateAssistantTurnResult> {
      if (!options.generateAssistantTurn) {
        throw new Error("generateAssistantTurn was not stubbed.");
      }

      return options.generateAssistantTurn(params);
    },
    streamAssistantTurn(
      params: GenerateAssistantTurnParams,
    ): AsyncGenerator<AssistantTurnStreamEvent, GenerateAssistantTurnResult> {
      if (!options.streamAssistantTurn) {
        throw new Error("streamAssistantTurn was not stubbed.");
      }

      return options.streamAssistantTurn(params);
    },
  };
}

async function collectQueryRun(
  client: LlmClient,
  useNativeOpenAIResponses = true,
  debug = false,
): Promise<{
  updates: QueryUpdate[];
  result: QueryResult;
}> {
  const iterator = query({
    client,
    model: "gpt-5.4",
    messages: [{
      role: "user",
      content: "hello",
    }],
    cwd: "D:\\test",
    useNativeOpenAIResponses,
    debug,
  });

  const updates: QueryUpdate[] = [];
  while (true) {
    const step = await iterator.next();
    if (step.done) {
      return {
        updates,
        result: step.value,
      };
    }

    updates.push(step.value);
  }
}

test("query falls back to blocking assistant turn when streaming fails", async () => {
  let generateAssistantTurnCalls = 0;
  let streamAssistantTurnCalls = 0;
  const client = createStubClient({
    async generateAssistantTurn() {
      generateAssistantTurnCalls += 1;
      return {
        blocks: [{
          type: "text",
          text: "Fallback answer",
        }],
        reasoningSummaries: ["Fallback summary"],
      };
    },
    async *streamAssistantTurn() {
      streamAssistantTurnCalls += 1;
      throw new Error("SSE unavailable");
    },
  });

  const { result } = await collectQueryRun(client);

  expect(streamAssistantTurnCalls).toBe(1);
  expect(generateAssistantTurnCalls).toBe(1);
  expect(result.assistantText).toBe("Fallback answer");
  expect(result.reasoningSummaries).toEqual(["Fallback summary"]);
});

test("query emits reasoning updates before the final assistant message", async () => {
  const client = createStubClient({
    async generateAssistantTurn() {
      throw new Error("blocking fallback should not run");
    },
    async *streamAssistantTurn() {
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

      return {
        blocks: [{
          type: "text",
          text: "Final answer",
        }],
        reasoningSummaries: ["Alpha", "Beta"],
        responseId: "resp_streamed",
      };
    },
  });

  const { updates, result } = await collectQueryRun(client);

  expect(updates.map((update) => ({
    reasoningDelta: update.reasoningDelta,
    reasoningSectionBreak: update.reasoningSectionBreak,
    addedMessages: update.addedMessages.length,
    reasoningSummaries: update.reasoningSummaries,
  }))).toEqual([
    {
      reasoningDelta: "Alpha",
      reasoningSectionBreak: undefined,
      addedMessages: 0,
      reasoningSummaries: undefined,
    },
    {
      reasoningDelta: undefined,
      reasoningSectionBreak: true,
      addedMessages: 0,
      reasoningSummaries: undefined,
    },
    {
      reasoningDelta: "Beta",
      reasoningSectionBreak: undefined,
      addedMessages: 0,
      reasoningSummaries: undefined,
    },
    {
      reasoningDelta: undefined,
      reasoningSectionBreak: undefined,
      addedMessages: 1,
      reasoningSummaries: undefined,
    },
  ]);
  expect(result.assistantText).toBe("Final answer");
  expect(result.reasoningSummaries).toEqual(["Alpha", "Beta"]);
  expect(result.lastResponseId).toBe("resp_streamed");
});

test("query emits commentary updates before the assistant message", async () => {
  const client = createStubClient({
    async generateAssistantTurn() {
      throw new Error("blocking fallback should not run");
    },
    async *streamAssistantTurn() {
      yield {
        type: "commentary_message",
        text: "我先检查项目结构",
      };

      return {
        blocks: [{
          type: "text",
          text: "Final answer",
        }],
        commentaryTexts: ["我先检查项目结构"],
        responseId: "resp_commentary",
      };
    },
  });

  const { updates, result } = await collectQueryRun(client);

  expect(updates).toEqual([
    {
      addedMessages: [],
      commentaryText: "我先检查项目结构",
    },
    {
      addedMessages: [{
        role: "assistant",
        content: [{
          type: "text",
          text: "Final answer",
        }],
      }],
      reasoningSummaries: undefined,
    },
  ]);
  expect(result.assistantText).toBe("Final answer");
  expect(result.lastResponseId).toBe("resp_commentary");
});

test("query uses full replay for native responses follow-up turns instead of previous_response_id continuation", async () => {
  let streamCallCount = 0;
  const seenCalls: GenerateAssistantTurnParams[] = [];
  const client = createStubClient({
    async generateAssistantTurn() {
      throw new Error("blocking path should not be used");
    },
    async *streamAssistantTurn(params) {
      streamCallCount += 1;
      seenCalls.push(params);

      if (streamCallCount === 1) {
        return {
          blocks: [{
            type: "tool_use",
            id: "call_test",
            name: "get_current_time",
            input: {},
          }],
          responseId: "resp_tool",
          rawOutputItems: [{
            type: "function_call",
          }],
        };
      }

      return {
        blocks: [{
          type: "text",
          text: "Replay answer",
        }],
        responseId: "resp_replay",
        rawOutputItems: [{
          type: "message",
          content: [{
            type: "output_text",
          }],
        }],
      };
    },
  });

  const { updates, result } = await collectQueryRun(client, true, true);

  expect(streamCallCount).toBe(2);
  expect(seenCalls[0]?.previousResponseId).toBeUndefined();
  expect(seenCalls[0]?.store).toBe(false);
  expect(seenCalls[1]?.previousResponseId).toBeUndefined();
  expect(seenCalls[1]?.store).toBe(false);
  expect(Array.isArray(seenCalls[1]?.messages)).toBe(true);
  expect((seenCalls[1]?.messages ?? []).length).toBeGreaterThan(1);
  expect(
    JSON.stringify((seenCalls[1]?.messages ?? [])),
  ).toContain("tool_result");
  expect(updates.some((update) =>
    (update.debugEntries ?? []).some((entry) =>
      entry.includes("query.nativeResponsesContinuationFallback")
    )
  )).toBe(false);
  expect(result.assistantText).toBe("Replay answer");
  expect(result.lastResponseId).toBe("resp_replay");
});

test("query de-duplicates repeated reasoning summaries across tool-loop iterations", async () => {
  let streamCallCount = 0;
  const client = createStubClient({
    async generateAssistantTurn() {
      throw new Error("blocking path should not be used");
    },
    async *streamAssistantTurn() {
      streamCallCount += 1;

      if (streamCallCount === 1) {
        return {
          blocks: [{
            type: "tool_use",
            id: "call_reasoning",
            name: "get_current_time",
            input: {},
          }],
          reasoningSummaries: [
            "Shared summary A",
            "Shared summary B",
          ],
          responseId: "resp_first",
        };
      }

      return {
        blocks: [{
          type: "text",
          text: "Final answer",
        }],
        reasoningSummaries: [
          "Shared summary A",
          "Shared summary B",
          "Final-only summary",
        ],
        responseId: "resp_second",
      };
    },
  });

  const { result } = await collectQueryRun(client, true, false);

  expect(streamCallCount).toBe(2);
  expect(result.reasoningSummaries).toEqual([
    "Shared summary A",
    "Shared summary B",
    "Final-only summary",
  ]);
  expect(result.assistantText).toBe("Final answer");
  expect(result.lastResponseId).toBe("resp_second");
});

test("query can continue past the old six-iteration tool loop limit", async () => {
  let streamCallCount = 0;
  const client = createStubClient({
    async generateAssistantTurn() {
      throw new Error("blocking path should not be used");
    },
    async *streamAssistantTurn() {
      streamCallCount += 1;

      if (streamCallCount <= 7) {
        return {
          blocks: [{
            type: "tool_use",
            id: `call_limit_${streamCallCount}`,
            name: "get_current_time",
            input: {},
          }],
          responseId: `resp_loop_${streamCallCount}`,
          rawOutputItems: [{
            type: "function_call",
          }],
        };
      }

      return {
        blocks: [{
          type: "text",
          text: "Finished after many tool rounds",
        }],
        responseId: "resp_loop_final",
        rawOutputItems: [{
          type: "message",
          content: [{
            type: "output_text",
          }],
        }],
      };
    },
  });

  const { updates, result } = await collectQueryRun(client, true, false);

  expect(streamCallCount).toBe(8);
  expect(
    updates.filter((update) =>
      update.addedMessages.some((message) =>
        Array.isArray(message.content) &&
        message.content.some((block) => block.type === "tool_use")
      )
    ).length,
  ).toBe(7);
  expect(result.assistantText).toBe("Finished after many tool rounds");
  expect(result.lastResponseId).toBe("resp_loop_final");
});
