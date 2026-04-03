/**
 * 文件信息
 * 时间：2026-04-03 23:50:53 +08:00
 * 作用：负责解析命令行参数，并将其映射为可执行的 CLI 动作。
 * 说明：保持纯函数设计，便于后续补充更多快捷参数和单元测试。
 */
export type ShortcutCommand = "help" | "version";

export type CliAction =
  | {
      type: "shortcut";
      command: ShortcutCommand;
    }
  | {
      type: "invalid-option";
      option: string;
    }
  | {
      type: "start";
    };

const shortcutFlagMap: Record<string, ShortcutCommand> = {
  "-h": "help",
  "--help": "help",
  "-v": "version",
  "--version": "version",
};

export function resolveCliAction(argv: string[]): CliAction {
  for (const arg of argv) {
    const command = shortcutFlagMap[arg];

    if (command) {
      return {
        type: "shortcut",
        command,
      };
    }

    if (arg.startsWith("-")) {
      return {
        type: "invalid-option",
        option: arg,
      };
    }
  }

  return { type: "start" };
}
