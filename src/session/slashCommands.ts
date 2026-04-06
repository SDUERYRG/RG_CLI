/**
 * 文件信息
 * 时间：2026-04-06 00:00:00 +08:00
 * 作用：处理交互会话中的 slash 命令。
 * 说明：命令层只返回结果，不直接操作 UI 状态，避免 session 层依赖界面层。
 */
import { createMessage, getWelcomeMessage } from "./messages.ts";
import type { ChatMessage } from "./types.ts";

export type SlashCommandResult =
  | { type: "not-a-command" }
  | { type: "append-messages"; messages: ChatMessage[] }
  | { type: "replace-messages"; messages: ChatMessage[] }
  | { type: "exit" };

export function executeSlashCommand(input: string): SlashCommandResult {
  const trimmed = input.trim();

  if (!trimmed.startsWith("/")) {
    return { type: "not-a-command" };
  }

  const [command] = trimmed.split(/\s+/);

  switch (command) {
    case "/help":
      return {
        type: "append-messages",
        messages: [
          createMessage("assistant", "可用命令：/help、/clear、/exit"),
        ],
      };

    case "/clear":
      return {
        type: "replace-messages",
        messages: [getWelcomeMessage()],
      };

    case "/exit":
      return {
        type: "exit",
      };

    default:
      return {
        type: "append-messages",
        messages: [
          createMessage("assistant", `未知命令：${command}`),
        ],
      };
  }
}
