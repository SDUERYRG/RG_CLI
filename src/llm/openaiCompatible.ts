/**
 * 文件信息
 * 时间：2026-04-09 00:00:00 +08:00
 * 作用：封装 OpenAI-compatible provider 的请求逻辑。
 * 说明：支持 responses 和 chat.completions 两种 wire API。
 */
import type { AppConfig } from "../config/defaults.ts";
import type {
  GenerateTextParams,
  GenerateTextResult,
  LlmClient,
  LlmMessage,
} from "./types.ts";

function buildUrl(baseUrl: string, path: string): string {
  const normalizedBaseUrl = baseUrl.endsWith("/")
    ? baseUrl.slice(0, -1)
    : baseUrl;
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${normalizedBaseUrl}${normalizedPath}`;
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

async function callResponsesApi(
  config: AppConfig,
  params: GenerateTextParams,
): Promise<GenerateTextResult> {
  const messages = normalizeConversationMessages(params.messages);

  const response = await fetch(buildUrl(config.llmBaseUrl, "/responses"), {
    method: "POST",
    headers: createRequestHeaders(config),
    body: JSON.stringify({
      model: params.model,
      input: buildResponsesPrompt(messages),
    }),
    signal: params.signal ?? AbortSignal.timeout(config.llmTimeoutMs),
  });

  const payload = await parseJsonSafely(response);

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

  return { text, raw: payload };
}

async function callChatCompletionsApi(
  config: AppConfig,
  params: GenerateTextParams,
): Promise<GenerateTextResult> {
  const messages = normalizeConversationMessages(params.messages);

  const response = await fetch(
    buildUrl(config.llmBaseUrl, "/chat/completions"),
    {
      method: "POST",
      headers: createRequestHeaders(config),
      body: JSON.stringify({
        model: params.model,
        messages,
      }),
      signal: params.signal ?? AbortSignal.timeout(config.llmTimeoutMs),
    },
  );

  const payload = await parseJsonSafely(response);

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
  return {
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
  };
}
