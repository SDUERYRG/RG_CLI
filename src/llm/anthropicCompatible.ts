/**
 * 文件信息
 * 时间：2026-04-09 00:00:00 +08:00
 * 作用：封装 Anthropic-compatible provider 的请求逻辑。
 * 说明：当前只实现 messages API，用于兼容默认 provider。
 */
import type { AppConfig } from "../config/defaults.ts";
import type {
  AssistantTurnStreamEvent,
  AgentConversationContentBlock,
  AgentConversationMessage,
  GenerateAssistantTurnParams,
  GenerateAssistantTurnResult,
  GenerateTextParams,
  GenerateTextResult,
  LlmClient,
  LlmMessage,
} from "./types.ts";
import { extractCommentaryFromText } from "./commentary.ts";

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

function isHtmlPayload(payload: unknown): payload is string {
  if (typeof payload !== "string") {
    return false;
  }

  const normalized = payload.trim().toLowerCase();
  return normalized.startsWith("<!doctype html") || normalized.startsWith("<html");
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
    `${apiName} 返回了 HTML 页面而不是 JSON。当前 llm.baseUrl 很可能指向了网站首页，而不是 Anthropic-compatible API 根地址：${baseUrl}`,
  );
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

function toAnthropicContent(
  role: AgentConversationMessage["role"],
  content: AgentConversationMessage["content"],
): string | Array<Record<string, unknown>> {
  if (typeof content === "string") {
    return content;
  }

  return content.map((block) => {
    if (block.type === "text") {
      return {
        type: "text",
        text: block.text,
      };
    }

    if (block.type === "tool_use") {
      return {
        type: "tool_use",
        id: block.id,
        name: block.name,
        input: block.input,
      };
    }

    if (role !== "user") {
      throw new Error("tool_result block 只能出现在 user 消息里。");
    }

    return {
      type: "tool_result",
      tool_use_id: block.toolUseId,
      content: block.content,
      is_error: block.isError ?? false,
    };
  });
}

function splitAnthropicConversationMessages(messages: AgentConversationMessage[]): {
  system?: string;
  conversation: Array<{
    role: "assistant" | "user";
    content: string | Array<Record<string, unknown>>;
  }>;
} {
  const systemChunks: string[] = [];
  const conversation: Array<{
    role: "assistant" | "user";
    content: string | Array<Record<string, unknown>>;
  }> = [];

  for (const message of messages) {
    if (message.role === "system") {
      const systemText = typeof message.content === "string"
        ? message.content.trim()
        : message.content
            .filter((block) => block.type === "text")
            .map((block) => block.text.trim())
            .filter(Boolean)
            .join("\n");
      if (systemText) {
        systemChunks.push(systemText);
      }
      continue;
    }

    conversation.push({
      role: message.role,
      content: toAnthropicContent(message.role, message.content),
    });
  }

  return {
    system: systemChunks.length > 0 ? systemChunks.join("\n\n") : undefined,
    conversation,
  };
}

function extractAssistantBlocksFromAnthropicPayload(
  payload: unknown,
): GenerateAssistantTurnResult {
  if (!payload || typeof payload !== "object") {
    return { blocks: [] };
  }

  const response = payload as {
    content?: Array<Record<string, unknown>>;
  };

  if (!Array.isArray(response.content)) {
    return { blocks: [] };
  }

  const blocks: GenerateAssistantTurnResult["blocks"] = [];
  const commentaryTexts: string[] = [];
  for (const block of response.content) {
    if (block.type === "text" && typeof block.text === "string") {
      const extracted = extractCommentaryFromText(block.text);
      commentaryTexts.push(...extracted.commentaryTexts);
      if (extracted.outputText.trim()) {
        blocks.push({
          type: "text",
          text: extracted.outputText,
        });
      }
      continue;
    }

    if (
      block.type === "tool_use" &&
      typeof block.id === "string" &&
      typeof block.name === "string" &&
      typeof block.input === "object" &&
      block.input !== null
    ) {
      blocks.push({
        type: "tool_use",
        id: block.id,
        name: block.name,
        input: block.input as Record<string, unknown>,
      });
    }
  }

  return {
    blocks,
    commentaryTexts: commentaryTexts.length > 0 ? commentaryTexts : undefined,
  };
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

async function* streamAssistantTurnByGenerating(
  generateAssistantTurn: () => Promise<GenerateAssistantTurnResult>,
): AsyncGenerator<AssistantTurnStreamEvent, GenerateAssistantTurnResult> {
  return await generateAssistantTurn();
}

export function createAnthropicCompatibleClient(config: AppConfig): LlmClient {
  const client: LlmClient = {
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
      assertNotHtmlPayload(payload, config.llmBaseUrl, "Anthropic-compatible messages");
      if (config.debug) {
        console.error("[RG_CLI][debug][anthropicCompatible.generateAssistantTurn]", JSON.stringify(payload, null, 2));
      }

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
    async generateAssistantTurn(
      params: GenerateAssistantTurnParams,
    ): Promise<GenerateAssistantTurnResult> {
      if (config.llmWireApi !== "messages") {
        throw new Error(
          `Anthropic-compatible provider 仅支持 messages wireApi，当前值为：${config.llmWireApi}`,
        );
      }

      const { system, conversation } = splitAnthropicConversationMessages(
        params.messages,
      );

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
          tools: params.tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            input_schema: tool.inputSchema,
          })),
          tool_choice: {
            type: params.toolChoice === "required" ? "any" : "auto",
          },
        }),
        signal: params.signal ?? AbortSignal.timeout(config.llmTimeoutMs),
      });

      const payload = await parseJsonSafely(response);
      assertNotHtmlPayload(payload, config.llmBaseUrl, "Anthropic-compatible tools");

      if (!response.ok) {
        const apiMessage = getErrorMessageFromPayload(payload);
        throw new Error(
          apiMessage
            ? `Anthropic-compatible tools 请求失败：${apiMessage}`
            : `Anthropic-compatible tools 请求失败：HTTP ${response.status}`,
        );
      }

      return {
        ...extractAssistantBlocksFromAnthropicPayload(payload),
        raw: payload,
      };
    },
    streamAssistantTurn(
      params: GenerateAssistantTurnParams,
    ): AsyncGenerator<AssistantTurnStreamEvent, GenerateAssistantTurnResult> {
      return streamAssistantTurnByGenerating(() => client.generateAssistantTurn(params));
    },
  };

  return client;
}
