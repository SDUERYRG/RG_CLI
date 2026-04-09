/**
 * 文件信息
 * 时间：2026-04-10 00:00:00 +08:00
 * 作用：执行模型请求的工具调用。
 * 说明：实现思路借鉴 claude-code 的 toolOrchestration，但这里先做串行、只读工具版本。
 */
import type {
  AgentToolResultBlock,
  AgentToolUseBlock,
} from "../session/types.ts";
import { findToolByName } from "./registry.ts";
import type { ToolExecutionContext } from "./types.ts";

export async function runToolCalls(
  toolCalls: AgentToolUseBlock[],
  context: ToolExecutionContext,
): Promise<Array<{ role: "user"; content: AgentToolResultBlock[] }>> {
  const results: Array<{ role: "user"; content: AgentToolResultBlock[] }> = [];

  for (const toolCall of toolCalls) {
    const tool = findToolByName(toolCall.name);

    if (!tool) {
      results.push({
        role: "user",
        content: [{
          type: "tool_result",
          toolUseId: toolCall.id,
          content: `未找到工具：${toolCall.name}`,
          isError: true,
        }],
      });
      continue;
    }

    const parsedInput = tool.inputSchema.safeParse(toolCall.input);
    if (!parsedInput.success) {
      results.push({
        role: "user",
        content: [{
          type: "tool_result",
          toolUseId: toolCall.id,
          content: `工具 ${tool.name} 输入不合法：${parsedInput.error.issues.map((issue) => issue.message).join("; ")}`,
          isError: true,
        }],
      });
      continue;
    }

    try {
      const executionResult = await tool.execute(parsedInput.data, context);
      results.push({
        role: "user",
        content: [{
          type: "tool_result",
          toolUseId: toolCall.id,
          content: executionResult.content,
          isError: executionResult.isError,
        }],
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({
        role: "user",
        content: [{
          type: "tool_result",
          toolUseId: toolCall.id,
          content: `工具 ${tool.name} 执行失败：${message}`,
          isError: true,
        }],
      });
    }
  }

  return results;
}
