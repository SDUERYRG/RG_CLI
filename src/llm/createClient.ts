/**
 * 文件信息
 * 时间：2026-04-09 00:00:00 +08:00
 * 作用：根据配置创建对应的大模型客户端。
 * 说明：统一出口，避免 UI 层直接依赖具体 provider 实现。
 */
import type { AppConfig } from "../config/defaults.ts";
import { createAnthropicCompatibleClient } from "./anthropicCompatible.ts";
import { createOpenAICompatibleClient } from "./openaiCompatible.ts";
import type { LlmClient } from "./types.ts";

export function createLlmClient(config: AppConfig): LlmClient {
  if (config.llmProvider === "openai-compatible") {
    return createOpenAICompatibleClient(config);
  }

  return createAnthropicCompatibleClient(config);
}
