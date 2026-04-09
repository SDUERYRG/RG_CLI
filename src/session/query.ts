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
  signal?: AbortSignal;
};

export type QueryResult = {
  messages: AgentMessage[];
  assistantText: string;
};

export type QueryUpdate = {
  addedMessages: AgentMessage[];
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
    const assistantTurn = await params.client.generateAssistantTurn({
      model: params.model,
      messages: params.systemPrompt
        ? [{ role: "system", content: params.systemPrompt }, ...workingMessages]
        : workingMessages,
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
