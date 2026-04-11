/**
 * Session-level query orchestration.
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
  updateChatSessionLastResponsesResponseId,
  updateChatSessionMessages,
} from "./storage.ts";
import type {
  AgentMessage,
  AgentToolResultBlock,
  AgentToolUseBlock,
} from "./types.ts";

type QueryEngineConfig = {
  config: AppConfig;
  client?: LlmClient;
};

export type QueryEngineStep = {
  session: PersistedChatSession;
  persist: boolean;
  liveThinkingText?: string;
};

const RG_CLI_AGENT_SYSTEM_PROMPT = [
  "你是 RG CLI，一个终端里的编程助手。",
  "当用户的问题需要查看当前环境、目录结构、文件内容或时间信息时，优先使用可用工具，不要凭空猜测。",
  "在收到工具结果后，继续推进，直到给出对用户有帮助的最终回答。",
  "除非信息仍然不足，否则不要在工具调用后停在空输出状态。",
  "生成思考摘要时，请使用与用户输入相同的语言。",
  "回答时先说结论，再补充你从工具里观察到的关键信息。",
].join("\n");

function deriveAgentMessagesFromSession(session: PersistedChatSession): AgentMessage[] {
  return session.agentMessages ?? [];
}

const MAX_TOOL_CALL_INPUT_LENGTH = 300;
const MAX_TOOL_RESULT_LINES = 4;

function formatToolInput(input: Record<string, unknown>): string {
  const serialized = JSON.stringify(input);

  if (!serialized) {
    return "{}";
  }

  if (serialized.length <= MAX_TOOL_CALL_INPUT_LENGTH) {
    return serialized;
  }

  return `${serialized.slice(0, MAX_TOOL_CALL_INPUT_LENGTH).trim()}...`;
}

function formatToolResult(content: string): string {
  const normalized = content
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
  const lines = normalized.split("\n");

  while (lines.length > 1 && lines.at(-1) === "") {
    lines.pop();
  }

  if (lines.length <= MAX_TOOL_RESULT_LINES) {
    return lines.join("\n");
  }

  const hiddenLineCount = lines.length - MAX_TOOL_RESULT_LINES;
  return [
    ...lines.slice(0, MAX_TOOL_RESULT_LINES),
    `${hiddenLineCount} lines+`,
  ].join("\n");
}

function createToolCallMessage(toolUse: AgentToolUseBlock) {
  return createMessage(
    "assistant",
    `调用${toolUse.name}工具，参数${formatToolInput(toolUse.input)}`,
    {
      includeInContext: false,
      kind: "tool_call",
    },
  );
}

function createToolResultMessage(toolResult: AgentToolResultBlock) {
  return createMessage(
    "assistant",
    formatToolResult(toolResult.content),
    {
      includeInContext: false,
      kind: "tool_result",
    },
  );
}

function createDebugMessage(content: string) {
  return createMessage(
    "assistant",
    content,
    {
      includeInContext: false,
      kind: "debug",
    },
  );
}

function createThinkingMessage(content: string) {
  return createMessage(
    "assistant",
    content,
    {
      includeInContext: false,
      kind: "thinking",
    },
  );
}

function joinReasoningSummaries(reasoningSummaries: string[] | undefined): string | undefined {
  if (!reasoningSummaries) {
    return undefined;
  }

  const normalizedSummaries = reasoningSummaries
    .map((summary) => summary.trim())
    .filter(Boolean);
  if (normalizedSummaries.length === 0) {
    return undefined;
  }

  return normalizedSummaries.join("\n\n");
}

function formatThinkingMessageContent(content: string): string {
  return `思考摘要\n${content}`;
}

function appendLiveThinkingText(
  currentText: string,
  reasoningDelta: string | undefined,
  reasoningSectionBreak: boolean | undefined,
): string {
  let nextText = currentText;

  if (reasoningSectionBreak && nextText.trim()) {
    nextText = `${nextText}\n\n`;
  }

  if (reasoningDelta) {
    nextText = `${nextText}${reasoningDelta}`;
  }

  return nextText;
}

function mergeThinkingText(
  currentText: string,
  reasoningSummaries: string[] | undefined,
): string {
  const summaryText = joinReasoningSummaries(reasoningSummaries);

  if (!summaryText) {
    return currentText;
  }

  const normalizedCurrent = currentText.trim();
  const normalizedSummary = summaryText.trim();

  if (!normalizedCurrent) {
    return normalizedSummary;
  }

  if (
    normalizedCurrent === normalizedSummary ||
    normalizedCurrent.includes(normalizedSummary)
  ) {
    return currentText;
  }

  if (normalizedSummary.includes(normalizedCurrent)) {
    return normalizedSummary;
  }

  return normalizedSummary;
}

function deriveDisplayMessagesFromAgentMessages(
  messages: AgentMessage[],
  pendingToolCallMessages: Map<string, ReturnType<typeof createMessage>>,
): {
  displayMessages: ReturnType<typeof createMessage>[];
  queuedToolCallCount: number;
} {
  const displayMessages: ReturnType<typeof createMessage>[] = [];
  let queuedToolCallCount = 0;

  for (const message of messages) {
    if (!Array.isArray(message.content)) {
      continue;
    }

    if (message.role === "assistant") {
      const hasToolUse = message.content.some((block) => block.type === "tool_use");

      if (!hasToolUse) {
        continue;
      }

      for (const block of message.content) {
        if (block.type === "text" && block.text.trim()) {
          displayMessages.push(createAssistantReply(block.text.trim(), {
            includeInContext: false,
          }));
          continue;
        }

        if (block.type === "tool_use") {
          pendingToolCallMessages.set(block.id, createToolCallMessage(block));
          queuedToolCallCount += 1;
        }
      }
      continue;
    }

    if (message.role === "user") {
      for (const block of message.content) {
        if (block.type === "tool_result") {
          const pendingToolCallMessage = pendingToolCallMessages.get(block.toolUseId);
          if (pendingToolCallMessage) {
            displayMessages.push(pendingToolCallMessage);
            pendingToolCallMessages.delete(block.toolUseId);
          }
          displayMessages.push(createToolResultMessage(block));
        }
      }
    }
  }

  return {
    displayMessages,
    queuedToolCallCount,
  };
}

function serializeAgentMessageForDebug(message: AgentMessage) {
  if (typeof message.content === "string") {
    return {
      role: message.role,
      content: message.content,
    };
  }

  return {
    role: message.role,
    content: message.content.map((block) => {
      if (block.type === "text") {
        return {
          type: "text",
          text: block.text,
        };
      }

      if (block.type === "tool_use") {
        return {
          type: "tool_use",
          id: block.id,
          name: block.name,
          input: block.input,
        };
      }

      return {
        type: "tool_result",
        toolUseId: block.toolUseId,
        content: block.content,
        isError: block.isError,
      };
    }),
  };
}

export class QueryEngine {
  private readonly config: AppConfig;
  private readonly client: LlmClient;

  constructor({ config, client }: QueryEngineConfig) {
    this.config = config;
    this.client = client ?? createLlmClient(config);
  }

  async *submitMessage(
    session: PersistedChatSession,
    prompt: string,
  ): AsyncGenerator<QueryEngineStep, PersistedChatSession> {
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
    yield {
      session: sessionAfterUserMessage,
      persist: true,
    };

    const agentMessages = [
      ...deriveAgentMessagesFromSession(session),
      userAgentMessage,
    ];
    let currentSession = updateChatSessionAgentMessages(
      sessionAfterUserMessage,
      agentMessages,
    );

    if (this.config.debug) {
      currentSession = updateChatSessionMessages(currentSession, [
        ...currentSession.messages,
        createDebugMessage(
          `[RG_CLI][debug] submitMessage.initialAgentMessages\n${JSON.stringify(
            agentMessages.map(serializeAgentMessageForDebug),
            null,
            2,
          )}`,
        ),
      ]);
      yield {
        session: currentSession,
        persist: true,
      };
    }

    const queryIterator = query({
      client: this.client,
      model: this.config.model,
      messages: agentMessages,
      cwd: getCwd(),
      systemPrompt: RG_CLI_AGENT_SYSTEM_PROMPT,
      previousResponseId: session.lastResponsesResponseId,
      useNativeOpenAIResponses: this.config.llmProvider === "openai-compatible" &&
        this.config.llmWireApi === "responses",
      reasoningEffort: this.config.llmReasoningEffort,
      reasoningSummary: this.config.llmReasoningSummary,
      debug: this.config.debug,
    });

    let queryResult: Awaited<ReturnType<typeof queryIterator.next>>["value"] | null =
      null;
    let currentAgentMessages = [...agentMessages];
    let liveThinkingText = "";
    let pendingThinkingText = "";
    let hasPersistedThinkingMessages = false;
    const pendingToolCallMessages = new Map<
      string,
      ReturnType<typeof createMessage>
    >();

    while (true) {
      const step = await queryIterator.next();
      if (step.done) {
        queryResult = step.value;
        break;
      }

      liveThinkingText = appendLiveThinkingText(
        liveThinkingText,
        step.value.reasoningDelta,
        step.value.reasoningSectionBreak,
      );
      pendingThinkingText = appendLiveThinkingText(
        pendingThinkingText,
        step.value.reasoningDelta,
        step.value.reasoningSectionBreak,
      );

      const newAgentMessages = step.value.addedMessages;
      currentAgentMessages = [...currentAgentMessages, ...newAgentMessages];
      const {
        displayMessages: toolDisplayMessages,
        queuedToolCallCount,
      } = deriveDisplayMessagesFromAgentMessages(
        newAgentMessages,
        pendingToolCallMessages,
      );
      const debugMessages = (step.value.debugEntries ?? []).map((entry) =>
        createDebugMessage(entry)
      );
      pendingThinkingText = mergeThinkingText(
        pendingThinkingText,
        step.value.reasoningSummaries,
      );

      currentSession = updateChatSessionAgentMessages(
        currentSession,
        currentAgentMessages,
      );

      const thinkingMessages = (toolDisplayMessages.length > 0 ||
            queuedToolCallCount > 0) &&
            pendingThinkingText.trim()
          ? [
            createThinkingMessage(
              formatThinkingMessageContent(pendingThinkingText.trim()),
            ),
          ]
          : [];

        if (thinkingMessages.length > 0) {
          pendingThinkingText = "";
          liveThinkingText = "";
          hasPersistedThinkingMessages = true;
        }

      if (
        toolDisplayMessages.length > 0 ||
        debugMessages.length > 0 ||
        thinkingMessages.length > 0
      ) {
        currentSession = updateChatSessionMessages(currentSession, [
          ...currentSession.messages,
          ...debugMessages,
          ...toolDisplayMessages,
          ...thinkingMessages,
        ]);
        yield {
          session: currentSession,
          persist: true,
          liveThinkingText: liveThinkingText || undefined,
        };
        continue;
      }

      if (step.value.reasoningDelta || step.value.reasoningSectionBreak) {
        yield {
          session: currentSession,
          persist: false,
          liveThinkingText: liveThinkingText || undefined,
        };
      }
    }

    if (!queryResult) {
      throw new Error("query() did not return a final result.");
    }

    const finalNewAgentMessages = queryResult.messages.slice(agentMessages.length);
    if (this.config.debug) {
      currentSession = updateChatSessionMessages(
        updateChatSessionAgentMessages(currentSession, queryResult.messages),
        [
          ...currentSession.messages,
          createDebugMessage(
            `[RG_CLI][debug] queryResult\n${JSON.stringify({
              newAgentMessages: finalNewAgentMessages,
              assistantText: queryResult.assistantText,
              reasoningSummaries: queryResult.reasoningSummaries ?? [],
              lastResponseId: queryResult.lastResponseId ?? null,
            }, null, 2)}`,
          ),
        ],
      );
      yield {
        session: currentSession,
        persist: true,
        liveThinkingText: liveThinkingText || undefined,
      };
    }

    const assistantText = queryResult.assistantText ||
      "工具调用已完成，但模型没有返回额外文本。";
    const fallbackThinkingSummary = !pendingThinkingText.trim() &&
        !hasPersistedThinkingMessages
      ? joinReasoningSummaries(queryResult.reasoningSummaries)
      : undefined;
    const finalThinkingMessages = pendingThinkingText.trim()
      ? [createThinkingMessage(formatThinkingMessageContent(pendingThinkingText.trim()))]
      : fallbackThinkingSummary
      ? [createThinkingMessage(formatThinkingMessageContent(fallbackThinkingSummary))]
      : [];

    const finalSession = updateChatSessionMessages(
      updateChatSessionLastResponsesResponseId(
        updateChatSessionAgentMessages(currentSession, queryResult.messages),
        queryResult.lastResponseId ?? currentSession.lastResponsesResponseId,
      ),
      [
        ...currentSession.messages,
        ...finalThinkingMessages,
        ...(assistantText
          ? [createAssistantReply(assistantText)]
          : []),
      ],
    );
    yield {
      session: finalSession,
      persist: true,
      liveThinkingText: undefined,
    };
    return finalSession;
  }
}
