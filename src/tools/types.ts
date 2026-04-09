/**
 * 文件信息
 * 时间：2026-04-10 00:00:00 +08:00
 * 作用：定义工具系统的基础类型。
 * 说明：实现思路借鉴 claude-code 的 Tool.ts，但保留适合 RG_CLI 的最小结构。
 */
import type { z } from "zod";

export type ToolExecutionContext = {
  cwd: string;
};

export type ToolExecutionResult = {
  content: string;
  isError?: boolean;
};

export type ToolDefinition<TInput extends Record<string, unknown>> = {
  name: string;
  description: string;
  inputSchema: z.ZodType<TInput>;
  inputJsonSchema: Record<string, unknown>;
  execute(
    input: TInput,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult>;
};
