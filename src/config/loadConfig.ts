/**
 * 文件信息
 * 时间：2026-04-06 00:00:00 +08:00
 * 作用：负责生成 CLI 启动时使用的最终配置对象。
 * 说明：当前按 default -> userSettings -> env -> argv 的优先级生成最终配置。
 */
import { defaultConfig, type AppConfig } from "./defaults.ts";
import {
  loadUserSettings,
  mapUserSettingsToConfigOverrides,
} from "./userSettings.ts";
import type { ConfigLoadResult } from "./types.ts";
import { isEnvTruthy } from "../utils/envUtils.ts";

export type ConfigOverrides = Partial<AppConfig>;

const CONFIG_BOOLEAN_FLAGS = new Set(["--debug"]);
const CONFIG_VALUE_FLAGS = new Set([
  "--cwd",
  "--model",
  "--base-url",
  "--api-key",
  "--provider",
  "--wire-api",
  "--reasoning-effort",
  "--reasoning-summary",
]);

function getInlineFlagValue(arg: string, flagName: string): string | undefined {
  const prefix = `${flagName}=`;

  if (!arg.startsWith(prefix)) {
    return undefined;
  }

  const value = arg.slice(prefix.length);

  if (!value) {
    throw new Error(`Flag ${flagName} requires a value.`);
  }

  return value;
}

export function isConfigFlag(arg: string): boolean {
  if (CONFIG_BOOLEAN_FLAGS.has(arg) || CONFIG_VALUE_FLAGS.has(arg)) {
    return true;
  }

  for (const flagName of CONFIG_VALUE_FLAGS) {
    if (arg.startsWith(`${flagName}=`)) {
      return true;
    }
  }

  return false;
}

export function parseConfigOverrides(argv: string[]): ConfigOverrides {
  const overrides: ConfigOverrides = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (!arg) {
      continue;
    }

    if (arg === "--debug") {
      overrides.debug = true;
      continue;
    }

    const inlineCwd = getInlineFlagValue(arg, "--cwd");
    if (inlineCwd !== undefined) {
      overrides.cwd = inlineCwd;
      continue;
    }

    const inlineModel = getInlineFlagValue(arg, "--model");
    if (inlineModel !== undefined) {
      overrides.model = inlineModel;
      continue;
    }

    const inlineBaseUrl = getInlineFlagValue(arg, "--base-url");
    if (inlineBaseUrl !== undefined) {
      overrides.llmBaseUrl = inlineBaseUrl;
      continue;
    }

    const inlineApiKey = getInlineFlagValue(arg, "--api-key");
    if (inlineApiKey !== undefined) {
      overrides.llmApiKey = inlineApiKey;
      continue;
    }

    const inlineProvider = getInlineFlagValue(arg, "--provider");
    if (inlineProvider !== undefined) {
      overrides.llmProvider = inlineProvider as AppConfig["llmProvider"];
      continue;
    }

    const inlineWireApi = getInlineFlagValue(arg, "--wire-api");
    if (inlineWireApi !== undefined) {
      overrides.llmWireApi = inlineWireApi as AppConfig["llmWireApi"];
      continue;
    }

    const inlineReasoningEffort = getInlineFlagValue(arg, "--reasoning-effort");
    if (inlineReasoningEffort !== undefined) {
      overrides.llmReasoningEffort = inlineReasoningEffort as AppConfig["llmReasoningEffort"];
      continue;
    }

    const inlineReasoningSummary = getInlineFlagValue(arg, "--reasoning-summary");
    if (inlineReasoningSummary !== undefined) {
      overrides.llmReasoningSummary = inlineReasoningSummary as AppConfig["llmReasoningSummary"];
      continue;
    }

    if (
      arg === "--cwd" ||
      arg === "--model" ||
      arg === "--base-url" ||
      arg === "--api-key" ||
      arg === "--provider" ||
      arg === "--wire-api" ||
      arg === "--reasoning-effort" ||
      arg === "--reasoning-summary"
    ) {
      const nextValue = argv[index + 1];

      if (!nextValue) {
        throw new Error(`Flag ${arg} requires a value.`);
      }

      if (arg === "--cwd") {
        overrides.cwd = nextValue;
      } else if (arg === "--model") {
        overrides.model = nextValue;
      } else if (arg === "--base-url") {
        overrides.llmBaseUrl = nextValue;
      } else if (arg === "--api-key") {
        overrides.llmApiKey = nextValue;
      } else if (arg === "--provider") {
        overrides.llmProvider = nextValue as AppConfig["llmProvider"];
      } else if (arg === "--reasoning-effort") {
        overrides.llmReasoningEffort = nextValue as AppConfig["llmReasoningEffort"];
      } else if (arg === "--reasoning-summary") {
        overrides.llmReasoningSummary = nextValue as AppConfig["llmReasoningSummary"];
      } else {
        overrides.llmWireApi = nextValue as AppConfig["llmWireApi"];
      }

      index += 1;
    }
  }

  return overrides;
}

function getEnvConfigOverrides(): ConfigOverrides {
  const overrides: ConfigOverrides = {};

  if (process.env.RG_CLI_CWD) {
    overrides.cwd = process.env.RG_CLI_CWD;
  }

  if (process.env.RG_CLI_MODEL) {
    overrides.model = process.env.RG_CLI_MODEL;
  }

  if (process.env.RG_CLI_BASE_URL) {
    overrides.llmBaseUrl = process.env.RG_CLI_BASE_URL;
  }

  if (process.env.RG_CLI_PROVIDER) {
    overrides.llmProvider = process.env.RG_CLI_PROVIDER as AppConfig["llmProvider"];
  }

  if (process.env.RG_CLI_WIRE_API) {
    overrides.llmWireApi = process.env.RG_CLI_WIRE_API as AppConfig["llmWireApi"];
  }

  if (process.env.RG_CLI_REASONING_EFFORT) {
    overrides.llmReasoningEffort = process.env.RG_CLI_REASONING_EFFORT as AppConfig["llmReasoningEffort"];
  }

  if (process.env.RG_CLI_REASONING_SUMMARY) {
    overrides.llmReasoningSummary = process.env.RG_CLI_REASONING_SUMMARY as AppConfig["llmReasoningSummary"];
  }

  if (process.env.RG_CLI_API_KEY) {
    overrides.llmApiKey = process.env.RG_CLI_API_KEY;
  } else if (process.env.OPENAI_API_KEY) {
    overrides.llmApiKey = process.env.OPENAI_API_KEY;
  } else if (process.env.ANTHROPIC_API_KEY) {
    overrides.llmApiKey = process.env.ANTHROPIC_API_KEY;
  }

  if (process.env.RG_CLI_DEBUG && isEnvTruthy(process.env.RG_CLI_DEBUG)) {
    overrides.debug = true;
  }

  return overrides;
}

function getDefaultModelForProvider(
  provider: AppConfig["llmProvider"],
): string {
  if (provider === "openai-compatible") {
    return "gpt-5.4";
  }

  return defaultConfig.model;
}

function getDefaultBaseUrlForProvider(
  provider: AppConfig["llmProvider"],
): string {
  if (provider === "openai-compatible") {
    return "https://api.openai.com/v1";
  }

  return defaultConfig.llmBaseUrl;
}

function getDefaultWireApiForProvider(
  provider: AppConfig["llmProvider"],
): AppConfig["llmWireApi"] {
  if (provider === "openai-compatible") {
    return "responses";
  }

  return "messages";
}

function normalizeConfig(
  merged: AppConfig,
  explicit: ConfigOverrides,
): AppConfig {
  const provider = merged.llmProvider;
  const hasExplicitModel = explicit.model !== undefined;
  const hasExplicitBaseUrl = explicit.llmBaseUrl !== undefined;
  const hasExplicitWireApi = explicit.llmWireApi !== undefined;

  return {
    ...merged,
    model: hasExplicitModel ? merged.model : getDefaultModelForProvider(provider),
    llmBaseUrl: hasExplicitBaseUrl
      ? merged.llmBaseUrl
      : getDefaultBaseUrlForProvider(provider),
    llmWireApi: hasExplicitWireApi
      ? merged.llmWireApi
      : getDefaultWireApiForProvider(provider),
  };
}

function formatUserSettingsWarnings(result: ConfigLoadResult["userSettings"]): string[] {
  if (result.errors.length === 0) {
    return [];
  }

  return result.errors.map((error) => {
    const location = error.path ? `${error.file}:${error.path}` : error.file;
    return location ? `${location} - ${error.message}` : error.message;
  });
}

export function loadConfigResult(
  input: string[] | ConfigOverrides = {},
): ConfigLoadResult {
  const argvOverrides = Array.isArray(input)
    ? parseConfigOverrides(input)
    : input;
  const userSettings = loadUserSettings();
  const userSettingsOverrides = mapUserSettingsToConfigOverrides(
    userSettings.settings,
  );
  const envOverrides = getEnvConfigOverrides();
  const explicitOverrides: ConfigOverrides = {
    ...userSettingsOverrides,
    ...envOverrides,
    ...argvOverrides,
  };

  return {
    config: normalizeConfig({
      ...defaultConfig,
      ...userSettingsOverrides,
      ...envOverrides,
      ...argvOverrides,
    }, explicitOverrides),
    warnings: formatUserSettingsWarnings(userSettings),
    userSettings,
  };
}

export function loadConfig(input: string[] | ConfigOverrides = {}): AppConfig {
  return loadConfigResult(input).config;
}
