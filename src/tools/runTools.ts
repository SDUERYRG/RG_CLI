/**
 * Execute model-requested tool calls one by one and yield each result as soon as it is ready.
 */
import type {
  AgentToolResultBlock,
  AgentToolUseBlock,
} from "../session/types.ts";
import { findToolByName } from "./registry.ts";
import type { ToolExecutionContext } from "./types.ts";

export async function* runToolCalls(
  toolCalls: AgentToolUseBlock[],
  context: ToolExecutionContext,
): AsyncGenerator<{ role: "user"; content: AgentToolResultBlock[] }, void> {
  for (const toolCall of toolCalls) {
    const tool = findToolByName(toolCall.name);

    if (!tool) {
      yield {
        role: "user",
        content: [{
          type: "tool_result",
          toolUseId: toolCall.id,
          content: `未找到工具：${toolCall.name}`,
          isError: true,
        }],
      };
      continue;
    }

    const parsedInput = tool.inputSchema.safeParse(toolCall.input);
    if (!parsedInput.success) {
      yield {
        role: "user",
        content: [{
          type: "tool_result",
          toolUseId: toolCall.id,
          content: `工具 ${tool.name} 输入不合法：${parsedInput.error.issues.map((issue) => issue.message).join("; ")}`,
          isError: true,
        }],
      };
      continue;
    }

    try {
      const executionResult = await tool.execute(parsedInput.data, context);
      yield {
        role: "user",
        content: [{
          type: "tool_result",
          toolUseId: toolCall.id,
          content: executionResult.content,
          isError: executionResult.isError,
        }],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      yield {
        role: "user",
        content: [{
          type: "tool_result",
          toolUseId: toolCall.id,
          content: `工具 ${tool.name} 执行失败：${message}`,
          isError: true,
        }],
      };
    }
  }
}
