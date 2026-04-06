/**
 * 文件信息
 * 时间：2026-04-06 00:20:00 +08:00
 * 作用：集中定义 CLI 层共享的动作、上下文和参数类型。
 * 说明：这些类型会被参数解析、顶层命令和入口调度共同使用，避免定义分散。
 */
import type { AppConfig } from "../config/defaults.ts";

export type ShortcutCommand = "help" | "version";

export type CliAction =
  | {
      type: "shortcut";
      command: ShortcutCommand;
    }
  | {
      type: "crash-test";
    }
  | {
      type: "invalid-option";
      option: string;
    }
  | {
      type: "start";
    };

export type TopLevelCommandName = "chat" | "config";

export type TopLevelCliAction =
  | {
      type: "none";
    }
  | {
      type: "command";
      name: TopLevelCommandName;
      args: string[];
    };

export type ParsedCliOptions = {
  rawArgs: string[];
  commandName?: TopLevelCommandName;
  commandArgs: string[];
  cwd?: string;
  model?: string;
  debug: boolean;
};

export type CliContext = {
  argv: string[];
  config: AppConfig;
  options: ParsedCliOptions;
};
