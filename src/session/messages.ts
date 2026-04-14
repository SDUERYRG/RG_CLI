/**
 * 文件信息
 * 时间：2026-04-06 00:00:00 +08:00
 * 作用：提供会话层的消息构造和默认回复逻辑。
 * 说明：这里承载消息创建、欢迎语和默认回复等纯业务逻辑，UI 层只负责展示和交互。
 */
import type { ChatMessage } from "./types.ts";

let nextMessageId = 1;

type CreateMessageOptions = {
  includeInContext?: boolean;
  toolCallId?: string;
  kind?: ChatMessage["kind"];
};

export function createMessage(
  role: ChatMessage["role"],
  content: string,
  options: CreateMessageOptions = {},
): ChatMessage {
  return {
    id: nextMessageId++,
    role,
    content,
    includeInContext: options.includeInContext,
    toolCallId: options.toolCallId,
    kind: options.kind,
  };
}

export function syncMessageIdSequence(messages: ChatMessage[]): void {
  const maxMessageId = messages.reduce((max, message) => {
    return Math.max(max, message.id);
  }, 0);

  nextMessageId = Math.max(nextMessageId, maxMessageId + 1);
}

export function getWelcomeMessage(): ChatMessage {
  return createMessage(
    "assistant",
    "你好，我是 RG CLI 助手。你可以先输入一条消息试试看。",
    { includeInContext: false },
  );
}

export function createAssistantReply(
  content: string,
  options: CreateMessageOptions = {},
): ChatMessage {
  return createMessage(
    "assistant",
    content,
    options,
  );
}
