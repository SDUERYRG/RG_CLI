/**
 * 文件信息
 * 时间：2026-04-09 00:00:00 +08:00
 * 作用：定义配置输入层类型，区分“用户配置文件结构”和“运行时最终配置结构”。
 * 说明：AppConfig 仍由 defaults.ts 负责，这里只描述 userSettings 读取链相关的类型。
 */
import type { AppConfig } from "./defaults.ts";

export type LlmProvider = "anthropic-compatible" | "openai-compatible";
export type LlmWireApi = "messages" | "responses" | "chat.completions";
export type LlmReasoningEffort =
  | "none"
  | "low"
  | "medium"
  | "high"
  | "xhigh";
export type LlmReasoningSummary = "auto" | "concise" | "detailed";

export type UserSettingsInput = {
  $schema?: string;
  cwd?: string;
  model?: string;
  debug?: boolean;
  color?: boolean;
  llm?: {
    provider?: LlmProvider;
    baseUrl?: string;
    apiKey?: string;
    model?: string;
    wireApi?: LlmWireApi;
    reasoningEffort?: LlmReasoningEffort;
    reasoningSummary?: LlmReasoningSummary;
    timeoutMs?: number;
    headers?: Record<string, string>;
  };
};

export type ConfigValidationError = {
  file?: string;
  path: string;
  message: string;
  invalidValue?: unknown;
  expected?: string;
};

export type UserSettingsLoadResult = {
  exists: boolean;
  filePath: string;
  settings: UserSettingsInput | null;
  errors: ConfigValidationError[];
};

export type ConfigLoadResult = {
  config: AppConfig;
  warnings: string[];
  userSettings: UserSettingsLoadResult;
};
