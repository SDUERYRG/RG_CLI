/**
 * 文件信息
 * 时间：2026-04-06 00:00:00 +08:00
 * 作用：提供会话层的消息构造和默认回复逻辑。
 * 说明：这里承载消息创建、欢迎语和默认回复等纯业务逻辑，UI 层只负责展示和交互。
 */
import type { ChatMessage } from "./types.ts";

let nextMessageId = 1;

export function createMessage(
  role: ChatMessage["role"],
  content: string,
): ChatMessage {
  return {
    id: nextMessageId++,
    role,
    content,
  };
}

export function getWelcomeMessage(): ChatMessage {
  return createMessage(
    "assistant",
    "你好，我是 RG CLI 助手。你可以先输入一条消息试试看。",
  );
}

export function createAssistantReply(content: string): ChatMessage {
  return createMessage(
    "assistant",
    content,
  );
}
