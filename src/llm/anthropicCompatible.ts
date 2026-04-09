/**
 * 文件信息
 * 时间：2026-04-09 00:00:00 +08:00
 * 作用：封装 Anthropic-compatible provider 的请求逻辑。
 * 说明：当前只实现 messages API，用于兼容默认 provider。
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
      "未配置 Anthropic-compatible API Key，请在 settings.json 中设置 llm.apiKey，或设置 RG_CLI_API_KEY / ANTHROPIC_API_KEY。",
    );
  }

  return {
    "Content-Type": "application/json",
    "x-api-key": config.llmApiKey,
    "anthropic-version": "2023-06-01",
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

function extractTextFromMessagesPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const response = payload as {
    content?: Array<{ type?: string; text?: string }>;
  };

  if (!Array.isArray(response.content)) {
    return null;
  }

  const chunks = response.content
    .filter((block) => block?.type === "text" && typeof block.text === "string")
    .map((block) => block.text!.trim())
    .filter(Boolean);

  return chunks.length > 0 ? chunks.join("\n") : null;
}

function splitAnthropicMessages(messages: LlmMessage[]): {
  system?: string;
  conversation: Array<{ role: "assistant" | "user"; content: string }>;
} {
  const systemChunks: string[] = [];
  const conversation: Array<{ role: "assistant" | "user"; content: string }> =
    [];

  for (const message of messages) {
    const content = message.content.trim();

    if (!content) {
      continue;
    }

    if (message.role === "system") {
      systemChunks.push(content);
      continue;
    }

    conversation.push({
      role: message.role,
      content,
    });
  }

  return {
    system: systemChunks.length > 0 ? systemChunks.join("\n\n") : undefined,
    conversation,
  };
}

export function createAnthropicCompatibleClient(config: AppConfig): LlmClient {
  return {
    async generateText(params: GenerateTextParams): Promise<GenerateTextResult> {
      if (config.llmWireApi !== "messages") {
        throw new Error(
          `Anthropic-compatible provider 仅支持 messages wireApi，当前值为：${config.llmWireApi}`,
        );
      }

      const { system, conversation } = splitAnthropicMessages(params.messages);

      if (conversation.length === 0) {
        throw new Error("当前没有可发送给模型的会话消息。");
      }

      const response = await fetch(buildUrl(config.llmBaseUrl, "/v1/messages"), {
        method: "POST",
        headers: createRequestHeaders(config),
        body: JSON.stringify({
          model: params.model,
          max_tokens: 2048,
          ...(system ? { system } : {}),
          messages: conversation,
        }),
        signal: params.signal ?? AbortSignal.timeout(config.llmTimeoutMs),
      });

      const payload = await parseJsonSafely(response);

      if (!response.ok) {
        const apiMessage = getErrorMessageFromPayload(payload);
        throw new Error(
          apiMessage
            ? `Anthropic-compatible messages 请求失败：${apiMessage}`
            : `Anthropic-compatible messages 请求失败：HTTP ${response.status}`,
        );
      }

      const text = extractTextFromMessagesPayload(payload);
      if (!text) {
        throw new Error(
          "Anthropic-compatible messages 返回成功，但未解析出文本内容。",
        );
      }

      return { text, raw: payload };
    },
  };
}
