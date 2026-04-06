/**
 * 文件信息
 * 时间：2026-04-03 23:50:53 +08:00
 * 作用：维护快捷参数入口与具体执行函数之间的映射关系。
 * 说明：新增快捷参数时优先在这里注册，统一管理帮助、版本等轻量入口。
 */
import { printHelp, printVersion } from "./output.ts";
import type { ShortcutCommand } from "./types.ts";

type ShortcutHandler = () => void;

const shortcutHandlers: Record<ShortcutCommand, ShortcutHandler> = {
  help: printHelp,
  version: printVersion,
};

export function runShortcut(command: ShortcutCommand): void {
  shortcutHandlers[command]();
}
