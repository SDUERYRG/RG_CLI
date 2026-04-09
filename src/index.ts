#!/usr/bin/env node
/**
 * 文件信息
 * 时间：2026-04-03 23:50:53 +08:00
 * 作用：作为 CLI 主入口，负责分发快捷参数入口和交互式界面启动流程。
 * 说明：这里控制启动顺序，不承载具体输出和界面细节。
 */
import { loadConfigResult } from "./config/loadConfig.ts";
import { runTopLevelCommand } from "./cli/commands.ts";
import { resolveCliAction } from "./cli/args.ts";
import {
  printConfigWarnings,
  printInvalidOption,
  printNonInteractiveNotice,
  printUnexpectedError,
} from "./cli/output.ts";
import { isInteractiveSession } from "./cli/runtime.ts";
import { runShortcut } from "./cli/shortcuts.ts";
import { getCwd, setCwd } from "./shared/cwd.ts";

export async function startCli(
  argv: string[] = process.argv.slice(2),
): Promise<void> {
  const action = resolveCliAction(argv);
  const configLoadResult = loadConfigResult(argv);
  const config = configLoadResult.config;

  printConfigWarnings(configLoadResult.warnings);

  if (action.type === "shortcut") {
    runShortcut(action.command);
    return;
  }

  if (action.type === "invalid-option") {
    printInvalidOption(action.option);
    process.exitCode = 1;
    return;
  }

  if (action.type === "crash-test") {
    throw new Error("Crash test triggered by --crash-test.");
  }

  if (config.cwd && config.cwd !== getCwd()) {
    setCwd(config.cwd);
  }

  const handled = await runTopLevelCommand(argv, configLoadResult);

  if (handled) {
    return;
  }

  if (!isInteractiveSession()) {
    printNonInteractiveNotice();
    return;
  }

  const { runApp } = await import("./ui/run.tsx");
  await runApp(config);
}


async function bootstrap(): Promise<void> {
  try {
    await startCli();
  } catch (error) {
    printUnexpectedError(error);
    process.exitCode = 1;
  }
}

if (import.meta.main) {
  void bootstrap();
}
