/**
 * 文件信息
 * 时间：2026-04-06 00:00:00 +08:00
 * 作用：定义会话层共享的消息领域类型。
 * 说明：把消息和会话相关结构从 UI 层抽离，避免业务类型反向依赖页面目录。
 */
export type MessageRole = "assistant" | "user";

export type ChatMessage = {
  id: number;
  role: MessageRole;
  content: string;
  includeInContext?: boolean;
  kind?: "regular" | "tool_call" | "tool_result";
};

export type AgentMessageRole = "system" | "assistant" | "user";

export type AgentTextBlock = {
  type: "text";
  text: string;
};

export type AgentToolUseBlock = {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
};

export type AgentToolResultBlock = {
  type: "tool_result";
  toolUseId: string;
  content: string;
  isError?: boolean;
};

export type AgentContentBlock =
  | AgentTextBlock
  | AgentToolUseBlock
  | AgentToolResultBlock;

export type AgentMessageContent = string | AgentContentBlock[];

export type AgentMessage = {
  role: AgentMessageRole;
  content: AgentMessageContent;
};
