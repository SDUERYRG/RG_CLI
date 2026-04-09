/**
 * 文件信息
 * 时间：2026-04-09 00:00:00 +08:00
 * 作用：定义 RG CLI 用户配置文件的 schema。
 * 说明：当前只覆盖 userSettings 第一阶段需要的最小字段，后续可继续扩展。
 */
import { z } from "zod";

export const UserSettingsSchema = z.object({
  $schema: z.string().optional(),
  cwd: z.string().optional(),
  model: z.string().min(1).optional(),
  debug: z.boolean().optional(),
  color: z.boolean().optional(),
  llm: z.object({
    provider: z.enum(["anthropic-compatible", "openai-compatible"]).optional(),
    baseUrl: z.url().optional(),
    apiKey: z.string().min(1).optional(),
    model: z.string().min(1).optional(),
    wireApi: z.enum(["messages", "responses", "chat.completions"]).optional(),
    timeoutMs: z.number().int().positive().optional(),
    headers: z.record(z.string(), z.string()).optional(),
  }).optional(),
});
