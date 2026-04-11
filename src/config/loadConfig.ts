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

const VALID_LLM_PROVIDERS = [
  "anthropic-compatible",
  "openai-compatible",
] as const;
const VALID_LLM_WIRE_APIS = [
  "messages",
  "responses",
  "chat.completions",
] as const;
const VALID_REASONING_EFFORTS = [
  "none",
  "low",
  "medium",
  "high",
  "xhigh",
] as const;
const VALID_REASONING_SUMMARIES = [
  "auto",
  "concise",
  "detailed",
] as const;

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

export function configFlagConsumesNextArg(arg: string): boolean {
  return CONFIG_VALUE_FLAGS.has(arg);
}

function parseEnumValue<TValue extends string>(
  value: string,
  validValues: readonly TValue[],
  label: string,
): TValue {
  if (validValues.includes(value as TValue)) {
    return value as TValue;
  }

  throw new Error(
    `${label} must be one of: ${validValues.join(", ")}. Received: ${value}`,
  );
}

function requireFlagValue(flagName: string, value: string | undefined): string {
  if (!value || value.startsWith("-")) {
    throw new Error(`Flag ${flagName} requires a value.`);
  }

  return value;
}

function assignConfigValueOverride(
  flagName: string,
  rawValue: string,
  overrides: ConfigOverrides,
): void {
  const value = rawValue.trim();

  if (flagName === "--cwd") {
    overrides.cwd = value;
    return;
  }

  if (flagName === "--model") {
    overrides.model = value;
    return;
  }

  if (flagName === "--base-url") {
    overrides.llmBaseUrl = value;
    return;
  }

  if (flagName === "--api-key") {
    overrides.llmApiKey = value;
    return;
  }

  if (flagName === "--provider") {
    overrides.llmProvider = parseEnumValue(
      value,
      VALID_LLM_PROVIDERS,
      "Flag --provider",
    );
    return;
  }

  if (flagName === "--wire-api") {
    overrides.llmWireApi = parseEnumValue(
      value,
      VALID_LLM_WIRE_APIS,
      "Flag --wire-api",
    );
    return;
  }

  if (flagName === "--reasoning-effort") {
    overrides.llmReasoningEffort = parseEnumValue(
      value,
      VALID_REASONING_EFFORTS,
      "Flag --reasoning-effort",
    );
    return;
  }

  overrides.llmReasoningSummary = parseEnumValue(
    value,
    VALID_REASONING_SUMMARIES,
    "Flag --reasoning-summary",
  );
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

    let handledInlineValue = false;
    for (const flagName of CONFIG_VALUE_FLAGS) {
      const inlineValue = getInlineFlagValue(arg, flagName);
      if (inlineValue === undefined) {
        continue;
      }

      assignConfigValueOverride(flagName, inlineValue, overrides);
      handledInlineValue = true;
      break;
    }

    if (handledInlineValue) {
      continue;
    }

    if (configFlagConsumesNextArg(arg)) {
      const nextValue = requireFlagValue(arg, argv[index + 1]);
      assignConfigValueOverride(arg, nextValue, overrides);
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
    overrides.llmProvider = parseEnumValue(
      process.env.RG_CLI_PROVIDER,
      VALID_LLM_PROVIDERS,
      "Environment variable RG_CLI_PROVIDER",
    );
  }

  if (process.env.RG_CLI_WIRE_API) {
    overrides.llmWireApi = parseEnumValue(
      process.env.RG_CLI_WIRE_API,
      VALID_LLM_WIRE_APIS,
      "Environment variable RG_CLI_WIRE_API",
    );
  }

  if (process.env.RG_CLI_REASONING_EFFORT) {
    overrides.llmReasoningEffort = parseEnumValue(
      process.env.RG_CLI_REASONING_EFFORT,
      VALID_REASONING_EFFORTS,
      "Environment variable RG_CLI_REASONING_EFFORT",
    );
  }

  if (process.env.RG_CLI_REASONING_SUMMARY) {
    overrides.llmReasoningSummary = parseEnumValue(
      process.env.RG_CLI_REASONING_SUMMARY,
      VALID_REASONING_SUMMARIES,
      "Environment variable RG_CLI_REASONING_SUMMARY",
    );
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
