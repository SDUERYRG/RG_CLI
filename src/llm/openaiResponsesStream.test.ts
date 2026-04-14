import { expect, test } from "bun:test";
import { streamOpenAIResponsesAssistantTurn } from "./openaiResponsesStream.ts";
import { extractAssistantBlocksFromResponsesPayload } from "./openaiCompatible.ts";

function createSseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  }), {
    status: 200,
    headers: {
      "content-type": "text/event-stream",
    },
  });
}

test("streamOpenAIResponsesAssistantTurn parses reasoning summary SSE events", async () => {
  const response = createSseResponse([
    "event: response.reasoning_summary_part.added\n",
    "data: {\"type\":\"response.reasoning_summary_part.added\",\"item_id\":\"rs_1\",\"summary_index\":0,\"part\":{\"type\":\"summary_text\"}}\n\n",
    "event: response.reasoning_summary_text.delta\n",
    "data: {\"type\":\"response.reasoning_summary_text.delta\",\"item_id\":\"rs_1\",\"summary_index\":0,\"delta\":\"First section.\"}\n\n",
    "event: response.reasoning_summary_part.added\n",
    "data: {\"type\":\"response.reasoning_summary_part.added\",\"item_id\":\"rs_1\",\"summary_index\":1,\"part\":{\"type\":\"summary_text\"}}\n\n",
    "event: response.reasoning_summary_text.delta\n",
    "data: {\"type\":\"response.reasoning_summary_text.delta\",\"item_id\":\"rs_1\",\"summary_index\":1,\"delta\":\"Second section.\"}\n\n",
    "event: response.output_text.delta\n",
    "data: {\"type\":\"response.output_text.delta\",\"delta\":\"Hello\"}\n\n",
    "event: response.output_item.done\n",
    "data: {\"type\":\"response.output_item.done\",\"output_index\":1,\"item\":{\"type\":\"message\",\"content\":[{\"type\":\"output_text\",\"text\":\"Hello\"}]}}\n\n",
    "event: response.completed\n",
    "data: {\"type\":\"response.completed\",\"response\":{\"id\":\"resp_123\",\"output\":[{\"type\":\"reasoning\",\"summary\":[{\"type\":\"summary_text\",\"text\":\"First section.\"},{\"type\":\"summary_text\",\"text\":\"Second section.\"}]},{\"type\":\"message\",\"content\":[{\"type\":\"output_text\",\"text\":\"Hello\"}]}]}}\n\n",
  ]);

  const iterator = streamOpenAIResponsesAssistantTurn({
    baseUrl: "https://api.openai.com/v1",
    urlCandidates: ["https://api.openai.com/v1/responses"],
    headers: {},
    body: {
      model: "gpt-5.4",
      input: [],
    },
    timeoutMs: 5_000,
    extractResultFromPayload: extractAssistantBlocksFromResponsesPayload,
    fetchImpl: async () => response,
  });

  const events: Array<{ type: string; delta?: string }> = [];
  let finalResult;

  while (true) {
    const step = await iterator.next();
    if (step.done) {
      finalResult = step.value;
      break;
    }

    events.push(step.value);
  }

  expect(events).toEqual([
    { type: "reasoning_delta", delta: "First section." },
    { type: "reasoning_section_break" },
    { type: "reasoning_delta", delta: "Second section." },
    { type: "output_text_delta", delta: "Hello" },
  ]);
  expect(finalResult.reasoningSummaries).toEqual([
    "First section.",
    "Second section.",
  ]);
  expect(finalResult.responseId).toBe("resp_123");
  expect(finalResult.blocks).toEqual([{
    type: "text",
    text: "Hello",
  }]);
});

test("streamOpenAIResponsesAssistantTurn falls back to synthetic output when completed payload is empty", async () => {
  const response = createSseResponse([
    "event: response.output_item.added\n",
    "data: {\"type\":\"response.output_item.added\",\"output_index\":0,\"item\":{\"id\":\"msg_1\",\"type\":\"message\",\"role\":\"assistant\",\"content\":[]}}\n\n",
    "event: response.content_part.added\n",
    "data: {\"type\":\"response.content_part.added\",\"output_index\":0,\"item_id\":\"msg_1\",\"content_index\":0,\"part\":{\"type\":\"output_text\",\"text\":\"\"}}\n\n",
    "event: response.output_text.delta\n",
    "data: {\"type\":\"response.output_text.delta\",\"output_index\":0,\"item_id\":\"msg_1\",\"content_index\":0,\"delta\":\"Recovered text\"}\n\n",
    "event: response.completed\n",
    "data: {\"type\":\"response.completed\",\"response\":{\"id\":\"resp_empty\",\"output\":[]}}\n\n",
  ]);

  const iterator = streamOpenAIResponsesAssistantTurn({
    baseUrl: "https://api.openai.com/v1",
    urlCandidates: ["https://api.openai.com/v1/responses"],
    headers: {},
    body: {
      model: "gpt-5.4",
      input: [],
    },
    timeoutMs: 5_000,
    extractResultFromPayload: extractAssistantBlocksFromResponsesPayload,
    fetchImpl: async () => response,
  });

  let finalResult;
  while (true) {
    const step = await iterator.next();
    if (step.done) {
      finalResult = step.value;
      break;
    }
  }

  expect(finalResult.responseId).toBe("resp_empty");
  expect(finalResult.blocks).toEqual([{
    type: "text",
    text: "Recovered text",
  }]);
  expect(finalResult.rawOutputItems).toEqual([{
    id: "msg_1",
    type: "message",
    role: "assistant",
    content: [{
      type: "output_text",
      text: "Recovered text",
    }],
  }]);
});

test("streamOpenAIResponsesAssistantTurn extracts commentary messages from output text deltas", async () => {
  const response = createSseResponse([
    "event: response.output_text.delta\n",
    "data: {\"type\":\"response.output_text.delta\",\"output_index\":0,\"item_id\":\"msg_1\",\"content_index\":0,\"delta\":\"<commentary>Inspecting files\"}\n\n",
    "event: response.output_text.delta\n",
    "data: {\"type\":\"response.output_text.delta\",\"output_index\":0,\"item_id\":\"msg_1\",\"content_index\":0,\"delta\":\"</commentary>Final answer\"}\n\n",
    "event: response.completed\n",
    "data: {\"type\":\"response.completed\",\"response\":{\"id\":\"resp_commentary\",\"output\":[{\"type\":\"message\",\"content\":[{\"type\":\"output_text\",\"text\":\"<commentary>Inspecting files</commentary>Final answer\"}]}]}}\n\n",
  ]);

  const iterator = streamOpenAIResponsesAssistantTurn({
    baseUrl: "https://api.openai.com/v1",
    urlCandidates: ["https://api.openai.com/v1/responses"],
    headers: {},
    body: {
      model: "gpt-5.4",
      input: [],
    },
    timeoutMs: 5_000,
    extractResultFromPayload: extractAssistantBlocksFromResponsesPayload,
    fetchImpl: async () => response,
  });

  const events: Array<{ type: string; delta?: string; text?: string }> = [];
  let finalResult;

  while (true) {
    const step = await iterator.next();
    if (step.done) {
      finalResult = step.value;
      break;
    }

    events.push(step.value);
  }

  expect(events).toEqual([
    { type: "commentary_message", text: "Inspecting files" },
    { type: "output_text_delta", delta: "Final answer" },
  ]);
  expect(finalResult.commentaryTexts).toEqual(["Inspecting files"]);
  expect(finalResult.blocks).toEqual([{
    type: "text",
    text: "Final answer",
  }]);
});
