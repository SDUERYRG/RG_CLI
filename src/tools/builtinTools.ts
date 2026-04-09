/**
 * 文件信息
 * 时间：2026-04-10 00:00:00 +08:00
 * 作用：注册 RG_CLI 当前内置工具。
 * 说明：先实现只读工具，跑通模型 -> 工具 -> 工具结果 -> 再回答 的最小闭环。
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { isAbsolute, join, normalize } from "node:path";
import { z } from "zod";
import type { ToolDefinition } from "./types.ts";

function resolvePathFromCwd(cwd: string, inputPath?: string): string {
  if (!inputPath || inputPath.trim().length === 0) {
    return cwd;
  }

  const trimmed = inputPath.trim();
  return normalize(isAbsolute(trimmed) ? trimmed : join(cwd, trimmed));
}

const getCurrentTimeTool: ToolDefinition<Record<string, never>> = {
  name: "get_current_time",
  description: "获取当前本地时间。",
  inputSchema: z.object({}),
  inputJsonSchema: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
  async execute() {
    return {
      content: new Date().toISOString(),
    };
  },
};

const getCurrentWorkingDirectoryTool: ToolDefinition<Record<string, never>> = {
  name: "get_current_working_directory",
  description: "获取当前 CLI 的工作目录。",
  inputSchema: z.object({}),
  inputJsonSchema: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
  async execute(_, context) {
    return {
      content: context.cwd,
    };
  },
};

const listDirectoryTool: ToolDefinition<{ path?: string }> = {
  name: "list_directory",
  description: "列出某个目录下的文件和子目录，适合先了解项目结构。",
  inputSchema: z.object({
    path: z.string().optional(),
  }),
  inputJsonSchema: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "要列出的目录路径，可省略，默认使用当前工作目录。",
      },
    },
    additionalProperties: false,
  },
  async execute(input, context) {
    const targetPath = resolvePathFromCwd(context.cwd, input.path);
    const targetStats = await stat(targetPath);

    if (!targetStats.isDirectory()) {
      return {
        content: `${targetPath} 不是一个目录。`,
        isError: true,
      };
    }

    const entries = await readdir(targetPath, { withFileTypes: true });
    const lines = entries
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((entry) => `${entry.isDirectory() ? "[DIR]" : "[FILE]"} ${entry.name}`);

    return {
      content: lines.length > 0
        ? `目录 ${targetPath} 下的内容：\n${lines.join("\n")}`
        : `目录 ${targetPath} 是空的。`,
    };
  },
};

const readFileTool: ToolDefinition<{ path: string }> = {
  name: "read_file",
  description: "读取文件内容，适合查看配置、源码或文档。",
  inputSchema: z.object({
    path: z.string().min(1),
  }),
  inputJsonSchema: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "要读取的文件路径，支持相对路径。",
      },
    },
    required: ["path"],
    additionalProperties: false,
  },
  async execute(input, context) {
    const targetPath = resolvePathFromCwd(context.cwd, input.path);
    const targetStats = await stat(targetPath);

    if (!targetStats.isFile()) {
      return {
        content: `${targetPath} 不是一个文件。`,
        isError: true,
      };
    }

    const raw = await readFile(targetPath, "utf8");
    const truncated = raw.length > 6_000
      ? `${raw.slice(0, 6_000)}\n\n[文件内容已截断，总长度 ${raw.length} 字符]`
      : raw;

    return {
      content: `文件路径：${targetPath}\n\n${truncated}`,
    };
  },
};

export const builtinTools = [
  getCurrentTimeTool,
  getCurrentWorkingDirectoryTool,
  listDirectoryTool,
  readFileTool,
] as const;
