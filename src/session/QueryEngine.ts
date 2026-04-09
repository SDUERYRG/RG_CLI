/**
 * 文件信息
 * 时间：2026-04-10 00:00:00 +08:00
 * 作用：管理会话级查询流程。
 * 说明：实现思路借鉴 claude-code 的 QueryEngine.ts：
 * 让 UI 不直接调模型，而是通过会话引擎提交消息。
 */
import type { AppConfig } from "../config/defaults.ts";
import { createLlmClient } from "../llm/createClient.ts";
import type { LlmClient } from "../llm/types.ts";
import { getCwd } from "../shared/cwd.ts";
import {
  createAssistantReply,
  createMessage,
} from "./messages.ts";
import { query } from "./query.ts";
import type { PersistedChatSession } from "./storage.ts";
import {
  updateChatSessionAgentMessages,
  updateChatSessionMessages,
} from "./storage.ts";
import type {
  AgentMessage,
  AgentToolResultBlock,
  AgentToolUseBlock,
} from "./types.ts";

type QueryEngineConfig = {
  config: AppConfig;
};

const RG_CLI_AGENT_SYSTEM_PROMPT = [
  "你是 RG CLI，一个终端里的编程助手。",
  "当用户的问题需要查看当前环境、目录结构、文件内容或时间信息时，优先使用可用工具，不要凭空猜测。",
  "在收到工具结果后，继续推进，直到给出对用户有帮助的最终回答。",
  "除非信息仍然不足，否则不要在工具调用后停在空输出状态。",
  "回答时先说结论，再补充你从工具里观察到的关键信息。",
].join("\n");

function deriveAgentMessagesFromSession(session: PersistedChatSession): AgentMessage[] {
  return session.agentMessages ?? [];
}

function formatToolInput(input: Record<string, unknown>): string {
  const serialized = JSON.stringify(input, null, 2);
  if (serialized.length <= 300) {
    return serialized;
  }

  return `${serialized.slice(0, 300).trim()}...`;
}

function formatToolResult(content: string): string {
  if (content.length <= 400) {
    return content;
  }

  return `${content.slice(0, 400).trim()}...\n\n[工具结果已截断]`;
}

function createToolCallMessage(toolUse: AgentToolUseBlock) {
  return createMessage(
    "assistant",
    `调用工具 ${toolUse.name}\n输入:\n${formatToolInput(toolUse.input)}`,
    {
      includeInContext: false,
      kind: "tool_call",
    },
  );
}

function createToolResultMessage(toolResult: AgentToolResultBlock) {
  const prefix = toolResult.isError ? "工具执行失败" : "工具执行结果";
  return createMessage(
    "assistant",
    `${prefix}\n${formatToolResult(toolResult.content)}`,
    {
      includeInContext: false,
      kind: "tool_result",
    },
  );
}

function deriveDisplayMessagesFromAgentMessages(
  messages: AgentMessage[],
): ReturnType<typeof createMessage>[] {
  const displayMessages: ReturnType<typeof createMessage>[] = [];

  for (const message of messages) {
    if (!Array.isArray(message.content)) {
      continue;
    }

    if (message.role === "assistant") {
      for (const block of message.content) {
        if (block.type === "tool_use") {
          displayMessages.push(createToolCallMessage(block));
        }
      }
      continue;
    }

    if (message.role === "user") {
      for (const block of message.content) {
        if (block.type === "tool_result") {
          displayMessages.push(createToolResultMessage(block));
        }
      }
    }
  }

  return displayMessages;
}

export class QueryEngine {
  private readonly config: AppConfig;
  private readonly client: LlmClient;

  constructor({ config }: QueryEngineConfig) {
    this.config = config;
    this.client = createLlmClient(config);
  }

  async *submitMessage(
    session: PersistedChatSession,
    prompt: string,
  ): AsyncGenerator<PersistedChatSession, PersistedChatSession> {
    const nextPrompt = prompt.trim();
    if (!nextPrompt) {
      return session;
    }

    const userDisplayMessage = createMessage("user", nextPrompt);
    const userAgentMessage: AgentMessage = {
      role: "user",
      content: nextPrompt,
    };

    const sessionAfterUserMessage = updateChatSessionMessages(session, [
      ...session.messages,
      userDisplayMessage,
    ]);
    yield sessionAfterUserMessage;
    const agentMessages = [
      ...deriveAgentMessagesFromSession(sessionAfterUserMessage),
      userAgentMessage,
    ];

    let currentSession = updateChatSessionAgentMessages(
      sessionAfterUserMessage,
      agentMessages,
    );

    const queryIterator = query({
      client: this.client,
      model: this.config.model,
      messages: agentMessages,
      cwd: getCwd(),
      systemPrompt: RG_CLI_AGENT_SYSTEM_PROMPT,
    });

    let queryResult: Awaited<ReturnType<typeof queryIterator.next>>["value"] | null =
      null;
    let currentAgentMessages = [...agentMessages];

    while (true) {
      const step = await queryIterator.next();
      if (step.done) {
        queryResult = step.value;
        break;
      }

      const newAgentMessages = step.value.addedMessages;
      currentAgentMessages = [...currentAgentMessages, ...newAgentMessages];
      const toolDisplayMessages = deriveDisplayMessagesFromAgentMessages(
        newAgentMessages,
      );

      currentSession = updateChatSessionAgentMessages(
        currentSession,
        currentAgentMessages,
      );

      if (toolDisplayMessages.length > 0) {
        currentSession = updateChatSessionMessages(currentSession, [
          ...currentSession.messages,
          ...toolDisplayMessages,
        ]);
        yield currentSession;
      }
    }

    if (!queryResult) {
      throw new Error("query() 未返回最终结果。");
    }

    const finalNewAgentMessages = queryResult.messages.slice(agentMessages.length);
    if (this.config.debug) {
      console.error("[RG_CLI][debug] queryResult", JSON.stringify({
        newAgentMessages: finalNewAgentMessages,
        assistantText: queryResult.assistantText,
      }, null, 2));
    }
    const assistantText = queryResult.assistantText ||
      "工具调用已完成，但模型没有返回额外文本。";

    const finalSession = updateChatSessionMessages(
      updateChatSessionAgentMessages(currentSession, queryResult.messages),
      [
        ...currentSession.messages,
        ...(assistantText
          ? [createAssistantReply(assistantText)]
          : []),
      ],
    );
    yield finalSession;
    return finalSession;
  }
}
