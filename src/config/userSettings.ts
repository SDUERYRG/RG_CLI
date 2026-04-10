/**
 * 文件信息
 * 时间：2026-04-09 00:00:00 +08:00
 * 作用：负责读取、解析和校验 userSettings。
 * 说明：当前仅支持用户级配置文件，不实现 project/local/policy 多来源配置。
 */
import { existsSync, readFileSync } from "node:fs";
import { ZodError } from "zod";
import type { AppConfig } from "./defaults.ts";
import { UserSettingsSchema } from "./schema.ts";
import type {
  ConfigValidationError,
  UserSettingsInput,
  UserSettingsLoadResult,
} from "./types.ts";
import { getUserSettingsFilePath } from "../utils/envUtils.ts";

function stripBOM(content: string): string {
  return content.charCodeAt(0) === 0xFEFF ? content.slice(1) : content;
}

function formatJsonError(
  filePath: string,
  error: unknown,
): ConfigValidationError[] {
  return [{
    file: filePath,
    path: "",
    message: `配置文件不是合法 JSON：${
      error instanceof Error ? error.message : String(error)
    }`,
  }];
}

function formatZodErrors(
  filePath: string,
  error: ZodError,
): ConfigValidationError[] {
  return error.issues.map((issue) => ({
    file: filePath,
    path: issue.path.map(String).join("."),
    message: issue.message,
    invalidValue: "input" in issue ? issue.input : undefined,
  }));
}

function parseUserSettingsContent(
  content: string,
  filePath: string,
): { settings: UserSettingsInput | null; errors: ConfigValidationError[] } {
  if (content.trim() === "") {
    return {
      settings: {},
      errors: [],
    };
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(stripBOM(content));
  } catch (error) {
    return {
      settings: null,
      errors: formatJsonError(filePath, error),
    };
  }

  const result = UserSettingsSchema.safeParse(parsedJson);

  if (!result.success) {
    return {
      settings: null,
      errors: formatZodErrors(filePath, result.error),
    };
  }

  return {
    settings: result.data,
    errors: [],
  };
}

export function loadUserSettings(): UserSettingsLoadResult {
  const filePath = getUserSettingsFilePath();

  if (!existsSync(filePath)) {
    return {
      exists: false,
      filePath,
      settings: null,
      errors: [],
    };
  }

  try {
    const content = readFileSync(filePath, "utf8");
    const { settings, errors } = parseUserSettingsContent(content, filePath);

    return {
      exists: true,
      filePath,
      settings,
      errors,
    };
  } catch (error) {
    return {
      exists: true,
      filePath,
      settings: null,
      errors: [{
        file: filePath,
        path: "",
        message: `读取用户配置失败：${
          error instanceof Error ? error.message : String(error)
        }`,
      }],
    };
  }
}

export function mapUserSettingsToConfigOverrides(
  settings: UserSettingsInput | null,
): Partial<AppConfig> {
  if (!settings) {
    return {};
  }

  const overrides: Partial<AppConfig> = {};

  if (settings.cwd !== undefined) {
    overrides.cwd = settings.cwd;
  }

  if (settings.debug !== undefined) {
    overrides.debug = settings.debug;
  }

  if (settings.color !== undefined) {
    overrides.color = settings.color;
  }

  if (settings.model !== undefined) {
    overrides.model = settings.model;
  }

  if (settings.llm?.provider !== undefined) {
    overrides.llmProvider = settings.llm.provider;
  }

  if (settings.llm?.baseUrl !== undefined) {
    overrides.llmBaseUrl = settings.llm.baseUrl;
  }

  if (settings.llm?.apiKey !== undefined) {
    overrides.llmApiKey = settings.llm.apiKey;
  }

  if (settings.llm?.wireApi !== undefined) {
    overrides.llmWireApi = settings.llm.wireApi;
  }

  if (settings.llm?.reasoningEffort !== undefined) {
    overrides.llmReasoningEffort = settings.llm.reasoningEffort;
  }

  if (settings.llm?.reasoningSummary !== undefined) {
    overrides.llmReasoningSummary = settings.llm.reasoningSummary;
  }

  if (settings.llm?.model !== undefined) {
    overrides.model = settings.llm.model;
  }

  if (settings.llm?.timeoutMs !== undefined) {
    overrides.llmTimeoutMs = settings.llm.timeoutMs;
  }

  if (settings.llm?.headers !== undefined) {
    overrides.llmHeaders = settings.llm.headers;
  }

  return overrides;
}
