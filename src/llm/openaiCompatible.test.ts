import { afterEach, expect, test } from "bun:test";
import { defaultConfig } from "../config/defaults.ts";
import { createOpenAICompatibleClient } from "./openaiCompatible.ts";

const originalFetch = globalThis.fetch;
const originalConsoleError = console.error;

afterEach(() => {
  globalThis.fetch = originalFetch;
  console.error = originalConsoleError;
});

test("responses replay includes function_call items before function_call_output items", async () => {
  const capturedBodies: Array<Record<string, unknown>> = [];

  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    const bodyText = typeof init?.body === "string" ? init.body : "";
    capturedBodies.push(JSON.parse(bodyText));

    return new Response(JSON.stringify({
      id: "resp_test",
      output: [{
        type: "message",
        content: [{
          type: "output_text",
          text: "ok",
        }],
      }],
    }), {
      status: 200,
      headers: {
        "content-type": "application/json",
      },
    });
  }) as typeof fetch;

  const client = createOpenAICompatibleClient({
    ...defaultConfig,
    llmProvider: "openai-compatible",
    llmWireApi: "responses",
    llmBaseUrl: "https://example.com/v1",
    llmApiKey: "test-key",
  });

  await client.generateAssistantTurn({
    model: "gpt-5.4",
    messages: [
      {
        role: "user",
        content: "请比较 Bun 和 Node",
      },
      {
        role: "assistant",
        content: [{
          type: "tool_use",
          id: "call_123",
          name: "get_current_time",
          input: {},
        }],
      },
      {
        role: "user",
        content: [{
          type: "tool_result",
          toolUseId: "call_123",
          content: "2026-04-10T14:08:27.601Z",
        }],
      },
    ],
    tools: [{
      name: "get_current_time",
      description: "Get current time",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    }],
  });

  expect(capturedBodies).toHaveLength(1);
  expect(capturedBodies[0]?.input).toEqual([
    {
      role: "user",
      content: "请比较 Bun 和 Node",
    },
    {
      type: "function_call",
      call_id: "call_123",
      name: "get_current_time",
      arguments: "{}",
    },
    {
      type: "function_call_output",
      call_id: "call_123",
      output: "2026-04-10T14:08:27.601Z",
    },
  ]);
  expect(capturedBodies[0]?.store).toBe(false);
  expect(capturedBodies[0]?.parallel_tool_calls).toBe(true);
  expect(capturedBodies[0]?.include).toEqual(["reasoning.encrypted_content"]);
  expect(capturedBodies[0]?.text).toEqual({
    format: {
      type: "text",
    },
    verbosity: "medium",
  });
});

test("html responses surface request and response details in debug mode", async () => {
  console.error = () => {};
  globalThis.fetch = (async () => {
    return new Response("<!DOCTYPE html><html><body>bad gateway</body></html>", {
      status: 502,
      statusText: "Bad Gateway",
      headers: {
        "content-type": "text/html; charset=utf-8",
      },
    });
  }) as unknown as typeof fetch;

  const client = createOpenAICompatibleClient({
    ...defaultConfig,
    debug: true,
    llmProvider: "openai-compatible",
    llmWireApi: "responses",
    llmBaseUrl: "https://example.com/v1",
    llmApiKey: "test-key",
  });

  await expect(client.generateAssistantTurn({
    model: "gpt-5.4",
    messages: [{
      role: "user",
      content: "hello",
    }],
    tools: [],
    store: true,
  })).rejects.toThrow(
    /request body:\n[\s\S]*"input": \[\s*\{\s*"role": "user",[\s\S]*response snippet:\n<!DOCTYPE html>/,
  );
});
