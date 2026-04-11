/**
 * 文件信息
 * 时间：2026-04-06 00:00:00 +08:00
 * 作用：维护顶层 CLI 命令注册和执行入口。
 * 说明：当前先提供板块一所需的最小结构，后续再扩展为真正的顶层命令系统。
 */
import {
  configFlagConsumesNextArg,
  isConfigFlag,
  parseConfigOverrides,
} from "../config/loadConfig.ts";
import { getCwd } from "../shared/cwd.ts";
import { writeTerminalBlock } from "../shared/terminal.ts";
import type {
  CliContext,
  ParsedCliOptions,
  TopLevelCliAction,
  TopLevelCommandName,
} from "./types.ts";

type CommandCliAction = Extract<TopLevelCliAction, { type: "command" }>;
type TopLevelCommandExecution = "handled" | "pass-through";

export type TopLevelCommand = {
  name: TopLevelCommandName;
  description: string;
  run: (
    context: CliContext,
    action: CommandCliAction,
  ) => Promise<TopLevelCommandExecution> | TopLevelCommandExecution;
};

const topLevelCommands: TopLevelCommand[] = [
  {
    name: "chat",
    description: "进入聊天模式",
    run: () => "pass-through",
  },
  {
    name: "config",
    description: "查看当前解析后的配置",
    run: (context) => {
      const maskedConfig = {
        ...context.config,
        llmApiKey: context.config.llmApiKey ? "***masked***" : undefined,
      };
      const warningLines = context.configLoadResult.warnings.length > 0
        ? [
          "",
          "配置警告：",
          ...context.configLoadResult.warnings.map((warning) => `- ${warning}`),
        ]
        : [];

      writeTerminalBlock([
        "当前配置：",
        JSON.stringify(maskedConfig, null, 2),
        "",
        "用户配置文件：",
        context.configLoadResult.userSettings.filePath,
        `文件存在：${context.configLoadResult.userSettings.exists ? "是" : "否"}`,
        ...warningLines,
        "",
        "当前激活的工作目录：",
        getCwd(),
      ]);
      return "handled";
    },
  },
];

export function getTopLevelCommandSummaries(): Array<
  Pick<TopLevelCommand, "name" | "description">
> {
  return topLevelCommands.map(({ name, description }) => ({
    name,
    description,
  }));
}

function parseTopLevelCliAction(argv: string[]): TopLevelCliAction {
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (!arg) {
      continue;
    }

    if (isConfigFlag(arg)) {
      if (configFlagConsumesNextArg(arg) && !arg.includes("=")) {
        index += 1;
      }
      continue;
    }

    if (arg.startsWith("-")) {
      continue;
    }

    if (arg === "chat" || arg === "config") {
      return {
        type: "command",
        name: arg,
        args: argv.slice(index + 1),
      };
    }

    return { type: "none" };
  }

  return { type: "none" };
}

function buildParsedCliOptions(
  argv: string[],
  action: TopLevelCliAction,
): ParsedCliOptions {
  const configOverrides = parseConfigOverrides(argv);

  if (action.type === "command") {
    return {
      rawArgs: argv,
      commandName: action.name,
      commandArgs: action.args,
      cwd: configOverrides.cwd,
      model: configOverrides.model,
      debug: configOverrides.debug ?? false,
    };
  }

  return {
    rawArgs: argv,
    commandArgs: [],
    cwd: configOverrides.cwd,
    model: configOverrides.model,
    debug: configOverrides.debug ?? false,
  };
}

export function getTopLevelCommand(
  commandName: TopLevelCommandName,
): TopLevelCommand | undefined {
  return topLevelCommands.find((command) => command.name === commandName);
}

export async function runTopLevelCommand(
  argv: string[],
  configLoadResult: CliContext["configLoadResult"],
): Promise<boolean> {
  const action = parseTopLevelCliAction(argv);

  if (action.type === "none") {
    return false;
  }

  const command = getTopLevelCommand(action.name);

  if (!command) {
    return false;
  }

  const context: CliContext = {
    argv,
    config: configLoadResult.config,
    configLoadResult,
    options: buildParsedCliOptions(argv, action),
  };

  const result = await command.run(context, action);
  return result === "handled";
}
