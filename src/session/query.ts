/**
 * 文件信息
 * 时间：2026-04-10 00:00:00 +08:00
 * 作用：执行单次用户请求的主循环。
 * 说明：实现思路借鉴 claude-code 的 query.ts：
 * 1. 先把上下文和工具一起发给模型。
 * 2. 如果模型要求调用工具，就执行工具。
 * 3. 把 tool_result 追加回消息，再继续下一轮。
 * 4. 没有 tool_use 时结束本轮。
 */
import type { LlmClient } from "../llm/types.ts";
import { getRegisteredTools } from "../tools/registry.ts";
import { runToolCalls } from "../tools/runTools.ts";
import type {
  AgentMessage,
  AgentTextBlock,
  AgentToolUseBlock,
} from "./types.ts";

const MAX_TOOL_ITERATIONS = 6;

export type QueryParams = {
  client: LlmClient;
  model: string;
  messages: AgentMessage[];
  cwd: string;
  systemPrompt?: string;
  debug?: boolean;
  signal?: AbortSignal;
};

export type QueryResult = {
  messages: AgentMessage[];
  assistantText: string;
};

export type QueryUpdate = {
  addedMessages: AgentMessage[];
  debugEntries?: string[];
};

function extractToolUses(
  message: AgentMessage,
): AgentToolUseBlock[] {
  if (!Array.isArray(message.content)) {
    return [];
  }

  return message.content.filter((block): block is AgentToolUseBlock =>
    block.type === "tool_use"
  );
}

function extractAssistantText(message: AgentMessage): string {
  if (typeof message.content === "string") {
    return message.content.trim();
  }

  return message.content
    .filter((block): block is AgentTextBlock => block.type === "text")
    .map((block) => block.text.trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

function getLatestUserPrompt(messages: AgentMessage[]): string {
  const latestUserMessage = [...messages]
    .reverse()
    .find((message) => message.role === "user");

  if (!latestUserMessage) {
    return "";
  }

  if (typeof latestUserMessage.content === "string") {
    return latestUserMessage.content.trim();
  }

  return latestUserMessage.content
    .filter((block): block is AgentTextBlock => block.type === "text")
    .map((block) => block.text.trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

function shouldForceToolUse(userPrompt: string): boolean {
  if (!userPrompt) {
    return false;
  }

  return /工作目录|cwd|目录|列出|文件|查看|读取|时间|time/i.test(userPrompt);
}

function stringifyBlockContent(message: AgentMessage): string {
  if (typeof message.content === "string") {
    return message.content.trim();
  }

  const parts: string[] = [];
  for (const block of message.content) {
    if (block.type === "text" && block.text.trim()) {
      parts.push(block.text.trim());
      continue;
    }

    if (block.type === "tool_result") {
      const text = block.content.trim();
      if (!text) {
        continue;
      }

      const shortened = text.length > 300
        ? `${text.slice(0, 300).trim()}...`
        : text;
      parts.push(`工具结果(${block.toolUseId})：${shortened}`);
    }
  }

  return parts.join("\n").trim();
}

function serializeAgentMessageForDebug(message: AgentMessage) {
  if (typeof message.content === "string") {
    return {
      role: message.role,
      content: message.content,
    };
  }

  return {
    role: message.role,
    content: message.content.map((block) => {
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

      return {
        type: "tool_result",
        toolUseId: block.toolUseId,
        content: block.content,
        isError: block.isError,
      };
    }),
  };
}

function buildToolSelectionMessages(
  messages: AgentMessage[],
  systemPrompt?: string,
): AgentMessage[] {
  const nonSystemMessages = messages.filter((message) => message.role !== "system");
  const latestUserIndex = [...nonSystemMessages]
    .map((message, index) => ({ message, index }))
    .reverse()
    .find((entry) => entry.message.role === "user")?.index;

  const latestUserMessage = latestUserIndex !== undefined
    ? nonSystemMessages[latestUserIndex]
    : undefined;
  const contextualCandidates = latestUserIndex !== undefined
    ? nonSystemMessages.slice(0, latestUserIndex)
    : nonSystemMessages;
  const tailContext = contextualCandidates.slice(-3);

  const contextualSummary = tailContext
    .map((message) => {
      const content = stringifyBlockContent(message);
      if (!content) {
        return "";
      }

      const label = message.role === "user" ? "用户" : "助手";
      return `${label}：${content}`;
    })
    .filter(Boolean)
    .join("\n\n");

  const lightweightMessages: AgentMessage[] = [];

  if (systemPrompt) {
    lightweightMessages.push({
      role: "system" as const,
      content: systemPrompt,
    });
  }

  if (contextualSummary) {
    lightweightMessages.push({
      role: "system" as const,
      content: `最近上下文摘要：\n${contextualSummary}`,
    });
  }

  if (latestUserMessage) {
    lightweightMessages.push(latestUserMessage);
  }

  return lightweightMessages.length > 0 ? lightweightMessages : messages;
}

export async function* query(
  params: QueryParams,
): AsyncGenerator<QueryUpdate, QueryResult> {
  let workingMessages = [...params.messages];
  const tools = getRegisteredTools();
  let attemptedEmptyAnswerRecovery = false;
  const shouldRequireToolOnFirstTurn = shouldForceToolUse(
    getLatestUserPrompt(workingMessages),
  );

  for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration += 1) {
    const messagesForToolSelection: AgentMessage[] = iteration === 0
      ? buildToolSelectionMessages(workingMessages, params.systemPrompt)
      : (params.systemPrompt
        ? [{ role: "system" as const, content: params.systemPrompt }, ...workingMessages]
        : workingMessages);

    if (params.debug) {
      yield {
        addedMessages: [],
        debugEntries: [
          `[RG_CLI][debug] query.toolSelectionContext\n${JSON.stringify(
            messagesForToolSelection.map(serializeAgentMessageForDebug),
            null,
            2,
          )}`,
        ],
      };
    }

    const assistantTurn = await params.client.generateAssistantTurn({
      model: params.model,
      messages: messagesForToolSelection,
      tools: tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputJsonSchema,
      })),
      toolChoice: iteration === 0 && shouldRequireToolOnFirstTurn
        ? "required"
        : "auto",
      signal: params.signal,
    });

    const assistantMessage: AgentMessage = {
      role: "assistant",
      content: assistantTurn.blocks,
    };
    workingMessages = [...workingMessages, assistantMessage];
    yield {
      addedMessages: [assistantMessage],
    };

    const toolUses = extractToolUses(assistantMessage);
    if (toolUses.length === 0) {
      const assistantText = extractAssistantText(assistantMessage);
      const hasToolResults = workingMessages.some((message) =>
        Array.isArray(message.content) &&
        message.content.some((block) => block.type === "tool_result")
      );

      if (!assistantText && hasToolResults && !attemptedEmptyAnswerRecovery) {
        attemptedEmptyAnswerRecovery = true;
        workingMessages = [
          ...workingMessages,
          {
            role: "user",
            content:
              "请基于上面的工具结果，直接回答用户原始问题。如果信息已经足够，不要继续调用工具。",
          },
        ];
        if (params.debug) {
          yield {
            addedMessages: [],
            debugEntries: [
              `[RG_CLI][debug] query.emptyAnswerRecoveryContext\n${JSON.stringify(
                workingMessages.map(serializeAgentMessageForDebug),
                null,
                2,
              )}`,
            ],
          };
        }
        continue;
      }

      return {
        messages: workingMessages,
        assistantText,
      };
    }

    const toolResults = await runToolCalls(toolUses, {
      cwd: params.cwd,
    });

    workingMessages = [
      ...workingMessages,
      ...toolResults,
    ];
    yield {
      addedMessages: toolResults,
    };
  }

  throw new Error(`工具调用轮次超过上限（${MAX_TOOL_ITERATIONS}）。`);
}
