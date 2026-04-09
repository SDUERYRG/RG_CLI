/**
 * 文件信息
 * 时间：2026-04-10 00:00:00 +08:00
 * 作用：提供工具注册表和工具查询方法。
 * 说明：保持和 claude-code 中“按名称查工具”的思路一致。
 */
import { builtinTools } from "./builtinTools.ts";
import type { ToolDefinition } from "./types.ts";

export function getRegisteredTools() {
  return [...builtinTools] as ToolDefinition<Record<string, unknown>>[];
}

export function findToolByName(name: string) {
  return builtinTools.find((tool) => tool.name === name) as
    | ToolDefinition<Record<string, unknown>>
    | undefined;
}

export function getToolSummaries(): Array<{ name: string; description: string }> {
  return builtinTools.map((tool) => ({
    name: tool.name,
    description: tool.description,
  }));
}
