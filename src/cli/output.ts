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
import { getTopLevelCommandSummaries } from "./commands.ts";
import { writeTerminalBlock } from "../shared/terminal.ts";

const APP_COMMAND = "rg-cli";

function getHelpLines(): string[] {
  const commandLines = getTopLevelCommandSummaries().map(
    ({ name, description }) => `  ${name.padEnd(10, " ")}${description}`,
  );

  return [
    APP_NAME,
    APP_DESCRIPTION,
    "",
    "使用如下指令:",
    `  ${APP_COMMAND} [options]`,
    `  ${APP_COMMAND} <command> [options]`,
    "",
    "命令:",
    ...commandLines,
    "",
    "选项:",
    "  -h, --help       显示帮助信息",
    "  -v, --version    显示 CLI 版本",
    "  --debug          启用调试模式",
    "  --cwd <path>     指定启动工作目录",
    "  --model <name>   指定模型名称",
    "  --base-url <url> 指定模型服务地址",
    "  --api-key <key>  指定模型服务密钥",
    "  --provider <id>  指定提供商（anthropic-compatible/openai-compatible）",
    "  --wire-api <id>  指定协议（messages/responses/chat.completions）",
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

function getErrorLines(error: unknown): string[] {
  if (error instanceof Error) {
    return (error.stack ?? error.message).split(/\r?\n/);
  }

  return [String(error)];
}

export function printConfigWarnings(warnings: string[]): void {
  if (warnings.length === 0) {
    return;
  }

  writeTerminalBlock(
    ["检测到用户配置问题，已回退到默认配置或其他覆盖项：", ...warnings.map((warning) => `- ${warning}`)],
    process.stderr,
  );
}

export function printUnexpectedError(error: unknown): void {
  writeTerminalBlock(
    ["RG CLI 启动失败:", ...getErrorLines(error)],
    process.stderr,
  );
}
