/**
 * 文件信息
 * 时间：2026-04-09 00:00:00 +08:00
 * 作用：封装 OpenAI-compatible provider 的请求逻辑。
 * 说明：支持 responses 和 chat.completions 两种 wire API。
 */
import type { AppConfig } from "../config/defaults.ts";
import type {
  AssistantTurnStreamEvent,
  AgentConversationMessage,
  GenerateAssistantTurnParams,
  GenerateAssistantTurnResult,
  GenerateTextParams,
  GenerateTextResult,
  LlmClient,
  LlmMessage,
} from "./types.ts";
import { streamOpenAIResponsesAssistantTurn } from "./openaiResponsesStream.ts";

function buildUrl(baseUrl: string, path: string): string {
  const normalizedBaseUrl = baseUrl.endsWith("/")
    ? baseUrl.slice(0, -1)
    : baseUrl;
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${normalizedBaseUrl}${normalizedPath}`;
}

function buildOpenAIPathCandidates(
  baseUrl: string,
  endpoint: "responses" | "chat/completions",
): string[] {
  const normalizedBaseUrl = baseUrl.endsWith("/")
    ? baseUrl.slice(0, -1)
    : baseUrl;

  if (normalizedBaseUrl.endsWith("/v1")) {
    return [buildUrl(normalizedBaseUrl, `/${endpoint}`)];
  }

  return [
    buildUrl(normalizedBaseUrl, `/v1/${endpoint}`),
    buildUrl(normalizedBaseUrl, `/${endpoint}`),
  ];
}

function createRequestHeaders(config: AppConfig): Record<string, string> {
  if (!config.llmApiKey) {
    throw new Error(
      "未配置 OpenAI-compatible API Key，请在 settings.json 中设置 llm.apiKey，或设置 RG_CLI_API_KEY / OPENAI_API_KEY。",
    );
  }

  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${config.llmApiKey}`,
    ...config.llmHeaders,
  };
}

async function parseJsonSafely(response: Response): Promise<unknown> {
  const text = await response.text();

  if (!text.trim()) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function getErrorMessageFromPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const error = (payload as { error?: { message?: string } }).error;
  return typeof error?.message === "string" ? error.message : null;
}

function isHtmlPayload(payload: unknown): payload is string {
  if (typeof payload !== "string") {
    return false;
  }

  const normalized = payload.trim().toLowerCase();
  return normalized.startsWith("<!doctype html") || normalized.startsWith("<html");
}

function truncateText(text: string, maxLength = 1_200): string {
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength).trim()}\n...[truncated]`;
}

function stringifyValueForError(value: unknown, maxLength = 4_000): string {
  let text = "";

  try {
    text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  } catch {
    text = String(value);
  }

  return truncateText(text, maxLength);
}

function buildHtmlPayloadErrorMessage(options: {
  apiName: string;
  url: string;
  body: Record<string, unknown>;
  payload: string;
  response: Response;
  includeRequestBody: boolean;
}): string {
  const lines = [
    `${options.apiName} 从 ${options.url} 返回了 HTML 页面而不是 JSON。`,
    `HTTP ${options.response.status} ${options.response.statusText || ""}`.trim(),
    `content-type: ${options.response.headers.get("content-type") ?? "(missing)"}`,
  ];

  if (options.includeRequestBody) {
    lines.push(`request body:\n${stringifyValueForError(options.body)}`);
  }

  lines.push(`response snippet:\n${truncateText(options.payload)}`);
  return lines.join("\n");
}

function assertNotHtmlPayload(
  payload: unknown,
  baseUrl: string,
  apiName: string,
): void {
  if (!isHtmlPayload(payload)) {
    return;
  }

  throw new Error(
    `${apiName} 返回了 HTML 页面而不是 JSON。当前 llm.baseUrl 可能不是 OpenAI-compatible API 根地址，或者上游返回了网关/错误页面：${baseUrl}`,
  );
}

async function fetchOpenAICompatibleJson(
  config: AppConfig,
  endpoint: "responses" | "chat/completions",
  body: Record<string, unknown>,
  apiName: string,
  signal?: AbortSignal,
): Promise<{
  payload: unknown;
  response: Response;
}> {
  const candidates = buildOpenAIPathCandidates(config.llmBaseUrl, endpoint);
  let lastError: Error | null = null;

  for (let index = 0; index < candidates.length; index += 1) {
    const url = candidates[index]!;
    const headers = createRequestHeaders(config);
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: signal ?? AbortSignal.timeout(config.llmTimeoutMs),
    });

    const payload = await parseJsonSafely(response);
    if (config.debug) {
      console.error(`[RG_CLI][debug][openaiCompatible.${apiName}]`, JSON.stringify({
        url,
        requestBody: body,
        responseStatus: response.status,
        responseStatusText: response.statusText,
        responseContentType: response.headers.get("content-type"),
        payload,
      }, null, 2));
    }

    if (isHtmlPayload(payload)) {
      lastError = new Error(buildHtmlPayloadErrorMessage({
        apiName,
        url,
        body,
        payload,
        response,
        includeRequestBody: config.debug,
      }));
      continue;
    }

    return { payload, response };
  }

  if (lastError) {
    throw lastError;
  }

  throw new Error(
    `${apiName} 请求失败：无法从 ${config.llmBaseUrl} 解析出有效 JSON 响应。`,
  );
}

function extractTextFromResponsesPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const response = payload as {
    output_text?: string | string[];
    output?: Array<{
      content?: Array<{ text?: string }>;
    }>;
  };

  if (typeof response.output_text === "string" && response.output_text.trim()) {
    return response.output_text.trim();
  }

  if (Array.isArray(response.output_text)) {
    const merged = response.output_text.join("\n").trim();
    if (merged) {
      return merged;
    }
  }

  if (!Array.isArray(response.output)) {
    return null;
  }

  const chunks: string[] = [];
  for (const item of response.output) {
    if (!Array.isArray(item?.content)) {
      continue;
    }
    for (const part of item.content) {
      if (typeof part?.text === "string" && part.text.trim()) {
        chunks.push(part.text.trim());
      }
    }
  }

  return chunks.length > 0 ? chunks.join("\n") : null;
}

export function extractReasoningSummariesFromResponsesPayload(payload: unknown): string[] {
  if (!payload || typeof payload !== "object") {
    return [];
  }

  const response = payload as {
    output?: Array<Record<string, unknown>>;
  };

  if (!Array.isArray(response.output)) {
    return [];
  }

  const summaries: string[] = [];
  const pushIfNonEmpty = (value: unknown) => {
    if (typeof value !== "string") {
      return;
    }

    const trimmed = value.trim();
    if (trimmed) {
      summaries.push(trimmed);
    }
  };

  for (const item of response.output) {
    if (item.type !== "reasoning") {
      continue;
    }

    if (Array.isArray(item.summary)) {
      for (const summary of item.summary) {
        if (typeof summary === "string") {
          pushIfNonEmpty(summary);
          continue;
        }

        if (!summary || typeof summary !== "object") {
          continue;
        }

        const summaryRecord = summary as Record<string, unknown>;
        const summaryType = typeof summaryRecord.type === "string"
          ? summaryRecord.type
          : "";

        if (
          (summaryType === "" || summaryType === "summary_text" || summaryType === "text") &&
          "text" in summaryRecord
        ) {
          pushIfNonEmpty(summaryRecord.text);
          continue;
        }

        if ("summary_text" in summaryRecord) {
          pushIfNonEmpty(summaryRecord.summary_text);
          continue;
        }

        if ("content" in summaryRecord && typeof summaryRecord.content === "string") {
          pushIfNonEmpty(summaryRecord.content);
          continue;
        }
      }
      continue;
    }

    if ("summary_text" in item) {
      pushIfNonEmpty(item.summary_text);
      continue;
    }

    if ("text" in item) {
      pushIfNonEmpty(item.text);
      continue;
    }

    if (typeof item.summary === "string") {
      pushIfNonEmpty(item.summary);
      continue;
    }

    if (Array.isArray(item.content)) {
      for (const part of item.content) {
        if (
          part &&
          typeof part === "object" &&
          "text" in part
        ) {
          pushIfNonEmpty((part as Record<string, unknown>).text);
        }
      }
    }
  }

  return summaries;
}

type ResponsesInputItem =
  | {
    role: "assistant" | "user";
    content: string;
  }
  | {
    type: "function_call";
    call_id: string;
    name: string;
    arguments: string;
  }
  | {
    type: "function_call_output";
    call_id: string;
    output: string;
  };

function buildResponsesInputItems(
  messages: AgentConversationMessage[],
): ResponsesInputItem[] {
  const items: ResponsesInputItem[] = [];
  let pendingTextRole: "assistant" | "user" | null = null;
  let pendingTextChunks: string[] = [];

  const flushPendingText = () => {
    if (!pendingTextRole || pendingTextChunks.length === 0) {
      pendingTextRole = null;
      pendingTextChunks = [];
      return;
    }

    const content = pendingTextChunks.join("\n").trim();
    if (content) {
      items.push({
        role: pendingTextRole,
        content,
      });
    }

    pendingTextRole = null;
    pendingTextChunks = [];
  };

  for (const message of messages) {
    if (message.role === "system") {
      continue;
    }

    if (typeof message.content === "string") {
      flushPendingText();
      const trimmed = message.content.trim();
      if (trimmed) {
        items.push({
          role: message.role,
          content: trimmed,
        });
      }
      continue;
    }

    for (const block of message.content) {
      if (block.type === "text") {
        const trimmed = block.text.trim();
        if (!trimmed) {
          continue;
        }

        if (pendingTextRole !== message.role) {
          flushPendingText();
          pendingTextRole = message.role;
        }
        pendingTextChunks.push(trimmed);
        continue;
      }

      flushPendingText();

      if (block.type === "tool_use") {
        items.push({
          type: "function_call",
          call_id: block.id,
          name: block.name,
          arguments: JSON.stringify(block.input),
        });
        continue;
      }

      items.push({
        type: "function_call_output",
        call_id: block.toolUseId,
        output: block.content,
      });
    }
  }

  flushPendingText();
  return items;
}

export function extractAssistantBlocksFromResponsesPayload(
  payload: unknown,
): GenerateAssistantTurnResult {
  if (!payload || typeof payload !== "object") {
    return { blocks: [] };
  }

  const response = payload as {
    id?: string;
    output?: Array<Record<string, unknown>>;
  };

  const blocks: GenerateAssistantTurnResult["blocks"] = [];

  for (const item of response.output ?? []) {
    if (item.type === "message" && Array.isArray(item.content)) {
      for (const part of item.content) {
        if (
          part &&
          typeof part === "object" &&
          "type" in part &&
          part.type === "output_text" &&
          "text" in part &&
          typeof part.text === "string" &&
          part.text.trim()
        ) {
          blocks.push({
            type: "text",
            text: part.text.trim(),
          });
        }
      }
      continue;
    }

    if (
      item.type === "function_call" &&
      typeof item.name === "string"
    ) {
      let input: Record<string, unknown> = {};
      if (typeof item.arguments === "string" && item.arguments.trim()) {
        try {
          const parsed = JSON.parse(item.arguments);
          if (parsed && typeof parsed === "object") {
            input = parsed as Record<string, unknown>;
          }
        } catch {
          input = {};
        }
      } else if (item.arguments && typeof item.arguments === "object") {
        input = item.arguments as Record<string, unknown>;
      }

      const callId = typeof item.call_id === "string" && item.call_id.trim()
        ? item.call_id
        : typeof item.id === "string" && item.id.trim()
        ? item.id
        : `function_call_${blocks.length}`;

      blocks.push({
        type: "tool_use",
        id: callId,
        name: item.name,
        input,
      });
    }
  }

  return {
    blocks,
    reasoningSummaries: extractReasoningSummariesFromResponsesPayload(payload),
    responseId: typeof response.id === "string" ? response.id : undefined,
    rawOutputItems: response.output,
    raw: payload,
  };
}

function extractTextFromChatCompletionsPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const response = payload as {
    choices?: Array<{
      message?: {
        content?: string | Array<{ text?: string }>;
      };
    }>;
  };

  const content = response.choices?.[0]?.message?.content;

  if (typeof content === "string" && content.trim()) {
    return content.trim();
  }

  if (Array.isArray(content)) {
    const merged = content
      .map((item) => typeof item?.text === "string" ? item.text.trim() : "")
      .filter(Boolean)
      .join("\n")
      .trim();
    return merged || null;
  }

  return null;
}

function toOpenAIChatMessages(messages: AgentConversationMessage[]): Array<Record<string, unknown>> {
  const result: Array<Record<string, unknown>> = [];

  for (const message of messages) {
    if (typeof message.content === "string") {
      result.push({
        role: message.role,
        content: message.content,
      });
      continue;
    }

    if (message.role === "user") {
      const textBlocks = message.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .filter(Boolean);

      if (textBlocks.length > 0) {
        result.push({
          role: "user",
          content: textBlocks.join("\n"),
        });
      }

      for (const block of message.content) {
        if (block.type !== "tool_result") {
          continue;
        }

        result.push({
          role: "tool",
          tool_call_id: block.toolUseId,
          content: block.content,
        });
      }

      continue;
    }

    if (message.role === "assistant") {
      const textBlocks = message.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .filter(Boolean);
      const toolCalls = message.content
        .filter((block) => block.type === "tool_use")
        .map((block) => ({
          id: block.id,
          type: "function",
          function: {
            name: block.name,
            arguments: JSON.stringify(block.input),
          },
        }));

      result.push({
        role: "assistant",
        content: textBlocks.length > 0 ? textBlocks.join("\n") : null,
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      });
      continue;
    }

    const systemText = message.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .filter(Boolean)
      .join("\n");

    result.push({
      role: "system",
      content: systemText,
    });
  }

  return result;
}

function extractAssistantBlocksFromChatCompletionsPayload(
  payload: unknown,
): GenerateAssistantTurnResult["blocks"] {
  if (!payload || typeof payload !== "object") {
    return [];
  }

  const response = payload as {
    choices?: Array<{
      message?: {
        content?: string | Array<{ text?: string }>;
        tool_calls?: Array<{
          id?: string;
          function?: {
            name?: string;
            arguments?: string;
          };
        }>;
      };
    }>;
  };

  const message = response.choices?.[0]?.message;
  if (!message) {
    return [];
  }

  const blocks: GenerateAssistantTurnResult["blocks"] = [];

  if (typeof message.content === "string" && message.content.trim()) {
    blocks.push({
      type: "text",
      text: message.content.trim(),
    });
  } else if (Array.isArray(message.content)) {
    const merged = message.content
      .map((item) => typeof item?.text === "string" ? item.text.trim() : "")
      .filter(Boolean)
      .join("\n")
      .trim();
    if (merged) {
      blocks.push({
        type: "text",
        text: merged,
      });
    }
  }

  for (const toolCall of message.tool_calls ?? []) {
    if (
      typeof toolCall?.id !== "string" ||
      typeof toolCall?.function?.name !== "string"
    ) {
      continue;
    }

    let input: Record<string, unknown> = {};
    if (typeof toolCall.function.arguments === "string" && toolCall.function.arguments.trim()) {
      try {
        const parsed = JSON.parse(toolCall.function.arguments);
        if (parsed && typeof parsed === "object") {
          input = parsed as Record<string, unknown>;
        }
      } catch {
        input = {};
      }
    }

    blocks.push({
      type: "tool_use",
      id: toolCall.id,
      name: toolCall.function.name,
      input,
    });
  }

  return blocks;
}

function normalizeConversationMessages(messages: LlmMessage[]): LlmMessage[] {
  return messages.filter((message) => message.content.trim().length > 0);
}

function buildResponsesPrompt(messages: LlmMessage[]): string {
  return messages.map((message) => {
    const label = message.role === "user"
      ? "User"
      : message.role === "assistant"
      ? "Assistant"
      : "System";
    return `${label}:\n${message.content}`;
  }).join("\n\n");
}

function buildResponsesInclude(
  reasoningEffort: GenerateTextParams["reasoningEffort"] | GenerateAssistantTurnParams["reasoningEffort"],
  reasoningSummary: GenerateTextParams["reasoningSummary"] | GenerateAssistantTurnParams["reasoningSummary"],
  config: AppConfig,
): string[] {
  const effectiveEffort = reasoningEffort ?? config.llmReasoningEffort;
  const effectiveSummary = reasoningSummary ?? config.llmReasoningSummary;

  if (effectiveEffort === "none" || effectiveSummary === undefined) {
    return [];
  }

  return ["reasoning.encrypted_content"];
}

function buildResponsesTextControls(): Record<string, unknown> {
  return {
    format: {
      type: "text",
    },
    verbosity: "medium",
  };
}

async function callResponsesApi(
  config: AppConfig,
  params: GenerateTextParams,
): Promise<GenerateTextResult> {
  const messages = normalizeConversationMessages(params.messages);
  const { response, payload } = await fetchOpenAICompatibleJson(
    config,
    "responses",
    {
      model: params.model,
      input: buildResponsesPrompt(messages),
      reasoning: {
        effort: params.reasoningEffort ?? config.llmReasoningEffort,
        summary: params.reasoningSummary ?? config.llmReasoningSummary,
      },
      parallel_tool_calls: true,
      include: buildResponsesInclude(
        params.reasoningEffort,
        params.reasoningSummary,
        config,
      ),
      text: buildResponsesTextControls(),
    },
    "responses",
    params.signal,
  );

  if (!response.ok) {
    const apiMessage = getErrorMessageFromPayload(payload);
    throw new Error(
      apiMessage
        ? `OpenAI-compatible responses 请求失败：${apiMessage}`
        : `OpenAI-compatible responses 请求失败：HTTP ${response.status}`,
    );
  }

  const text = extractTextFromResponsesPayload(payload);
  if (!text) {
    throw new Error("OpenAI-compatible responses 返回成功，但未解析出文本内容。");
  }

  return {
    text,
    reasoningSummaries: extractReasoningSummariesFromResponsesPayload(payload),
    raw: payload,
  };
}

async function callResponsesAssistantTurn(
  config: AppConfig,
  params: GenerateAssistantTurnParams,
): Promise<GenerateAssistantTurnResult> {
  const { response, payload } = await fetchOpenAICompatibleJson(
    config,
    "responses",
    buildResponsesAssistantTurnBody(config, params),
    "generateAssistantTurn",
    params.signal,
  );

  if (!response.ok) {
    const apiMessage = getErrorMessageFromPayload(payload);
    throw new Error(
      apiMessage
        ? `OpenAI-compatible responses tool turn failed: ${apiMessage}`
        : `OpenAI-compatible responses tool turn failed: HTTP ${response.status}`,
    );
  }

  return extractAssistantBlocksFromResponsesPayload(payload);
}

function buildResponsesAssistantTurnBody(
  config: AppConfig,
  params: GenerateAssistantTurnParams,
): Record<string, unknown> {
  const inputItems = buildResponsesInputItems(params.messages);

  return {
    model: params.model,
    input: inputItems,
    tools: params.tools.map((tool) => ({
      type: "function",
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    })),
    tool_choice: params.toolChoice === "required" ? "required" : "auto",
    parallel_tool_calls: true,
    reasoning: {
      effort: params.reasoningEffort ?? config.llmReasoningEffort,
      summary: params.reasoningSummary ?? config.llmReasoningSummary,
    },
    store: params.store ?? false,
    include: buildResponsesInclude(
      params.reasoningEffort,
      params.reasoningSummary,
      config,
    ),
    text: buildResponsesTextControls(),
    ...(params.instructions ? { instructions: params.instructions } : {}),
    ...(params.previousResponseId
      ? { previous_response_id: params.previousResponseId }
      : {}),
  };
}

async function callChatCompletionsApi(
  config: AppConfig,
  params: GenerateTextParams,
): Promise<GenerateTextResult> {
  const messages = normalizeConversationMessages(params.messages);
  const { response, payload } = await fetchOpenAICompatibleJson(
    config,
    "chat/completions",
    {
      model: params.model,
      messages,
    },
    "chat.completions",
    params.signal,
  );

  if (!response.ok) {
    const apiMessage = getErrorMessageFromPayload(payload);
    throw new Error(
      apiMessage
        ? `OpenAI-compatible chat.completions 请求失败：${apiMessage}`
        : `OpenAI-compatible chat.completions 请求失败：HTTP ${response.status}`,
    );
  }

  const text = extractTextFromChatCompletionsPayload(payload);
  if (!text) {
    throw new Error(
      "OpenAI-compatible chat.completions 返回成功，但未解析出文本内容。",
    );
  }

  return { text, raw: payload };
}

export function createOpenAICompatibleClient(config: AppConfig): LlmClient {
  const client: LlmClient = {
    async generateText(params: GenerateTextParams): Promise<GenerateTextResult> {
      if (config.llmWireApi === "responses") {
        return callResponsesApi(config, params);
      }

      if (config.llmWireApi === "chat.completions") {
        return callChatCompletionsApi(config, params);
      }

      throw new Error(
        `OpenAI-compatible provider 不支持当前 wireApi：${config.llmWireApi}`,
      );
    },
    async generateAssistantTurn(
      params: GenerateAssistantTurnParams,
    ): Promise<GenerateAssistantTurnResult> {
      if (config.llmWireApi === "responses") {
        return callResponsesAssistantTurn(config, params);
      }

      const { response, payload } = await fetchOpenAICompatibleJson(
        config,
        "chat/completions",
        {
          model: params.model,
          messages: toOpenAIChatMessages(params.messages),
          tools: params.tools.map((tool) => ({
            type: "function",
            function: {
              name: tool.name,
              description: tool.description,
              parameters: tool.inputSchema,
            },
          })),
          tool_choice: params.toolChoice === "required" ? "required" : "auto",
        },
        "generateAssistantTurn",
        params.signal,
      );

      if (!response.ok) {
        const apiMessage = getErrorMessageFromPayload(payload);
        throw new Error(
          apiMessage
            ? `OpenAI-compatible tools 请求失败：${apiMessage}`
            : `OpenAI-compatible tools 请求失败：HTTP ${response.status}`,
        );
      }

      return {
        blocks: extractAssistantBlocksFromChatCompletionsPayload(payload),
        raw: payload,
      };
    },
    streamAssistantTurn(
      params: GenerateAssistantTurnParams,
    ): AsyncGenerator<AssistantTurnStreamEvent, GenerateAssistantTurnResult> {
      if (config.llmWireApi === "responses") {
        return streamOpenAIResponsesAssistantTurn({
          baseUrl: config.llmBaseUrl,
          urlCandidates: buildOpenAIPathCandidates(config.llmBaseUrl, "responses"),
          headers: createRequestHeaders(config),
          body: buildResponsesAssistantTurnBody(config, params),
          timeoutMs: config.llmTimeoutMs,
          signal: params.signal,
          extractResultFromPayload: extractAssistantBlocksFromResponsesPayload,
        });
      }

      return streamAssistantTurnByGenerating(() => client.generateAssistantTurn(params));
    },
  };

  return client;
}

async function* streamAssistantTurnByGenerating(
  generateAssistantTurn: () => Promise<GenerateAssistantTurnResult>,
): AsyncGenerator<AssistantTurnStreamEvent, GenerateAssistantTurnResult> {
  return await generateAssistantTurn();
}
