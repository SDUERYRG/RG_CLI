/**
 * 文件信息
 * 时间：2026-04-06 00:00:00 +08:00
 * 作用：负责生成 CLI 启动时使用的最终配置对象。
 * 说明：当前仅合并默认配置与启动覆盖项，后续再扩展文件配置和环境变量配置。
 */
import { defaultConfig, type AppConfig } from "./defaults.ts";

export type ConfigOverrides = Partial<AppConfig>;

const CONFIG_BOOLEAN_FLAGS = new Set(["--debug"]);
const CONFIG_VALUE_FLAGS = new Set(["--cwd", "--model"]);

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

    if (arg === "--cwd" || arg === "--model") {
      const nextValue = argv[index + 1];

      if (!nextValue) {
        throw new Error(`Flag ${arg} requires a value.`);
      }

      if (arg === "--cwd") {
        overrides.cwd = nextValue;
      } else {
        overrides.model = nextValue;
      }

      index += 1;
    }
  }

  return overrides;
}

export function loadConfig(input: string[] | ConfigOverrides = {}): AppConfig {
  const overrides = Array.isArray(input)
    ? parseConfigOverrides(input)
    : input;

  return {
    ...defaultConfig,
    ...overrides,
  };
}
