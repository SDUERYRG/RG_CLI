/**
 * 文件信息
 * 时间：2026-04-03 23:50:53 +08:00
 * 作用：集中管理 CLI 的文本输出，如帮助信息、版本信息和错误提示。
 * 说明：把输出文案从入口逻辑中拆开，能降低分支判断与展示文案的耦合。
 */
import {
  APP_DESCRIPTION,
  APP_NAME,
  APP_PACKAGE_NAME,
  APP_VERSION,
} from "../config/app.ts";
import { writeTerminalBlock } from "../shared/terminal.ts";

const APP_COMMAND = "rg-cli";

function getHelpLines(): string[] {
  return [
    APP_NAME,
    APP_DESCRIPTION,
    "",
    "使用如下指令:",
    `  ${APP_COMMAND} [options]`,
    "",
    "选项:",
    "  -h, --help       显示帮助信息",
    "  -v, --version    显示 CLI 版本",
    "",
    "版本:",
    `  ${APP_PACKAGE_NAME}@${APP_VERSION}`,
  ];
}

export function printHelp(): void {
  writeTerminalBlock(getHelpLines());
}

export function printVersion(): void {
  writeTerminalBlock([`${APP_NAME} v${APP_VERSION}`]);
}

export function printInvalidOption(option: string): void {
  writeTerminalBlock([`未知选项: ${option}`, "", ...getHelpLines()]);
}

export function printNonInteractiveNotice(): void {
  writeTerminalBlock([
    "RG CLI 需要在交互式终端中启动 UI。",
    "请尝试以下命令:",
    `  ${APP_COMMAND} --help`,
    `  ${APP_COMMAND} --version`,
  ]);
}
