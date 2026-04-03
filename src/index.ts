#!/usr/bin/env bun
/**
 * 文件信息
 * 时间：2026-04-03 23:50:53 +08:00
 * 作用：作为 CLI 主入口，负责分发快捷指令和交互式界面启动流程。
 * 说明：这里控制启动顺序，不承载具体输出和界面细节。
 */
import { resolveCliAction } from "./cli/args.ts";
import { printInvalidOption, printNonInteractiveNotice } from "./cli/output.ts";
import { isInteractiveSession } from "./cli/runtime.ts";
import { runShortcut } from "./cli/shortcutHandlers.ts";

export async function startCli(
  argv: string[] = process.argv.slice(2),
): Promise<void> {
  const action = resolveCliAction(argv);

  if (action.type === "shortcut") {
    runShortcut(action.command);
    return;
  }

  if (action.type === "invalid-option") {
    printInvalidOption(action.option);
    process.exitCode = 1;
    return;
  }

  if (!isInteractiveSession()) {
    printNonInteractiveNotice();
    return;
  }

  const { runApp } = await import("./ui/run.tsx");
  await runApp();
}

if (import.meta.main) {
  await startCli();
}
