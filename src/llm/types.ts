/**
 * 文件信息
 * 时间：2026-04-09 00:00:00 +08:00
 * 作用：定义大模型调用层的共享类型。
 * 说明：先抽出统一接口，后续扩展更多 provider 时可以保持 UI 层稳定。
 */

export type LlmMessageRole = "system" | "assistant" | "user";

export type LlmMessage = {
  role: LlmMessageRole;
  content: string;
};

export type LlmToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export type AgentConversationMessageRole = "system" | "assistant" | "user";

export type AgentConversationTextBlock = {
  type: "text";
  text: string;
};

export type AgentConversationToolUseBlock = {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
};

export type AgentConversationToolResultBlock = {
  type: "tool_result";
  toolUseId: string;
  content: string;
  isError?: boolean;
};

export type AgentConversationContentBlock =
  | AgentConversationTextBlock
  | AgentConversationToolUseBlock
  | AgentConversationToolResultBlock;

export type AgentConversationMessage = {
  role: AgentConversationMessageRole;
  content: string | AgentConversationContentBlock[];
};

export type GenerateTextParams = {
  model: string;
  messages: LlmMessage[];
  reasoningEffort?: "none" | "low" | "medium" | "high" | "xhigh";
  reasoningSummary?: "auto" | "concise" | "detailed";
  signal?: AbortSignal;
};

export type GenerateTextResult = {
  text: string;
  reasoningSummaries?: string[];
  raw?: unknown;
};

export type GenerateAssistantTurnParams = {
  model: string;
  messages: AgentConversationMessage[];
  tools: LlmToolDefinition[];
  toolChoice?: "auto" | "required";
  reasoningEffort?: "none" | "low" | "medium" | "high" | "xhigh";
  reasoningSummary?: "auto" | "concise" | "detailed";
  previousResponseId?: string;
  instructions?: string;
  store?: boolean;
  signal?: AbortSignal;
};

export type GenerateAssistantTurnResult = {
  blocks: Array<
    | AgentConversationTextBlock
    | AgentConversationToolUseBlock
  >;
  reasoningSummaries?: string[];
  responseId?: string;
  rawOutputItems?: unknown[];
  raw?: unknown;
};

export type AssistantTurnStreamEvent =
  | {
    type: "reasoning_delta";
    delta: string;
  }
  | {
    type: "reasoning_section_break";
  }
  | {
    type: "output_text_delta";
    delta: string;
  };

export interface LlmClient {
  generateText(params: GenerateTextParams): Promise<GenerateTextResult>;
  generateAssistantTurn(
    params: GenerateAssistantTurnParams,
  ): Promise<GenerateAssistantTurnResult>;
  streamAssistantTurn(
    params: GenerateAssistantTurnParams,
  ): AsyncGenerator<AssistantTurnStreamEvent, GenerateAssistantTurnResult>;
}
