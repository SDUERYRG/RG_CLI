/**
 * 文件信息
 * 时间：2026-04-03 23:50:53 +08:00
 * 作用：提供消息创建和默认回复生成等纯函数工具。
 * 说明：把消息生成逻辑从页面组件中拿出来，便于复用和后续接入真实服务。
 */
import type { ChatMessage } from "../types.ts";

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

export function createAssistantReply(input: string): ChatMessage {
  return createMessage(
    "assistant",
    `收到你的消息：“${input}”。下一步我们可以继续接入真实指令和业务逻辑。`,
  );
}
