/**
 * Query loop for a single user turn.
 *
 * The loop supports two execution styles:
 * 1. Legacy replay mode: send context + tools every round.
 * 2. Native OpenAI Responses mode: bootstrap once, then continue with
 *    previous_response_id + function_call_output items.
 */
import type {
  AssistantTurnStreamEvent,
  GenerateAssistantTurnParams,
  GenerateAssistantTurnResult,
  LlmClient,
} from "../llm/types.ts";
import { getRegisteredTools } from "../tools/registry.ts";
import { runToolCalls } from "../tools/runTools.ts";
import type {
  AgentMessage,
  AgentTextBlock,
  AgentToolUseBlock,
} from "./types.ts";

const EMPTY_ANSWER_RECOVERY_PROMPT =
  "Please answer the user's original question directly using the tool results above. If the information is already sufficient, do not call more tools.";

export type QueryParams = {
  client: LlmClient;
  model: string;
  messages: AgentMessage[];
  cwd: string;
  systemPrompt?: string;
  previousResponseId?: string;
  useNativeOpenAIResponses?: boolean;
  reasoningEffort?: "none" | "low" | "medium" | "high" | "xhigh";
  reasoningSummary?: "auto" | "concise" | "detailed";
  debug?: boolean;
  signal?: AbortSignal;
};

export type QueryResult = {
  messages: AgentMessage[];
  assistantText: string;
  reasoningSummaries?: string[];
  lastResponseId?: string;
};

export type QueryUpdate = {
  addedMessages: AgentMessage[];
  debugEntries?: string[];
  reasoningDelta?: string;
  reasoningSectionBreak?: boolean;
};

function summarizeRawOutputItemTypes(items: unknown[] | undefined): string[] {
  if (!Array.isArray(items)) {
    return [];
  }

  return items.map((item) => {
    if (!item || typeof item !== "object") {
      return typeof item;
    }

    const type = "type" in item && typeof item.type === "string"
      ? item.type
      : "unknown";
    if (type === "message" && "content" in item && Array.isArray(item.content)) {
      const contentTypes = item.content
        .map((part) =>
          part && typeof part === "object" && "type" in part && typeof part.type === "string"
            ? part.type
            : "unknown"
        )
        .join(",");
      return `${type}(${contentTypes})`;
    }

    return type;
  });
}

function extractToolUses(
  message: AgentMessage,
): AgentToolUseBlock[] {
  if (!Array.isArray(message.content)) {
    return [];
  }

  return message.content.filter((block): block is AgentToolUseBlock =>
    block.type === "tool_use"
  );
}

function extractAssistantText(message: AgentMessage): string {
  if (typeof message.content === "string") {
    return message.content.trim();
  }

  return message.content
    .filter((block): block is AgentTextBlock => block.type === "text")
    .map((block) => block.text.trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

function getLatestUserMessage(messages: AgentMessage[]): AgentMessage | undefined {
  return [...messages]
    .reverse()
    .find((message) => message.role === "user");
}

function getLatestUserPrompt(messages: AgentMessage[]): string {
  const latestUserMessage = getLatestUserMessage(messages);

  if (!latestUserMessage) {
    return "";
  }

  if (typeof latestUserMessage.content === "string") {
    return latestUserMessage.content.trim();
  }

  return latestUserMessage.content
    .filter((block): block is AgentTextBlock => block.type === "text")
    .map((block) => block.text.trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

function shouldForceToolUse(userPrompt: string): boolean {
  if (!userPrompt) {
    return false;
  }

  return /cwd|directory|list|file|read|time|工作目录|目录|列出|文件|查看|读取|时间/i.test(
    userPrompt,
  );
}

function stringifyBlockContent(message: AgentMessage): string {
  if (typeof message.content === "string") {
    return message.content.trim();
  }

  const parts: string[] = [];
  for (const block of message.content) {
    if (block.type === "text" && block.text.trim()) {
      parts.push(block.text.trim());
      continue;
    }

    if (block.type === "tool_result") {
      const text = block.content.trim();
      if (!text) {
        continue;
      }

      const shortened = text.length > 300
        ? `${text.slice(0, 300).trim()}...`
        : text;
      parts.push(`Tool result (${block.toolUseId}): ${shortened}`);
    }
  }

  return parts.join("\n").trim();
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

function buildToolSelectionMessages(
  messages: AgentMessage[],
  systemPrompt?: string,
): AgentMessage[] {
  const nonSystemMessages = messages.filter((message) => message.role !== "system");
  const latestUserIndex = [...nonSystemMessages]
    .map((message, index) => ({ message, index }))
    .reverse()
    .find((entry) => entry.message.role === "user")?.index;

  const latestUserMessage = latestUserIndex !== undefined
    ? nonSystemMessages[latestUserIndex]
    : undefined;
  const contextualCandidates = latestUserIndex !== undefined
    ? nonSystemMessages.slice(0, latestUserIndex)
    : nonSystemMessages;
  const tailContext = contextualCandidates.slice(-3);

  const contextualSummary = tailContext
    .map((message) => {
      const content = stringifyBlockContent(message);
      if (!content) {
        return "";
      }

      const label = message.role === "user" ? "User" : "Assistant";
      return `${label}: ${content}`;
    })
    .filter(Boolean)
    .join("\n\n");

  const lightweightMessages: AgentMessage[] = [];

  if (systemPrompt) {
    lightweightMessages.push({
      role: "system" as const,
      content: systemPrompt,
    });
  }

  if (contextualSummary) {
    lightweightMessages.push({
      role: "system" as const,
      content: `Recent context summary:\n${contextualSummary}`,
    });
  }

  if (latestUserMessage) {
    lightweightMessages.push(latestUserMessage);
  }

  return lightweightMessages.length > 0 ? lightweightMessages : messages;
}

function buildInstructionsForAssistantTurn(
  messages: AgentMessage[],
  fallbackSystemPrompt?: string,
): string | undefined {
  const systemChunks = messages
    .filter((message) => message.role === "system")
    .map((message) => {
      if (typeof message.content === "string") {
        return message.content.trim();
      }

      return message.content
        .filter((block) => block.type === "text")
        .map((block) => block.text.trim())
        .filter(Boolean)
        .join("\n")
        .trim();
    })
    .filter(Boolean);

  if (systemChunks.length > 0) {
    return systemChunks.join("\n\n");
  }

  return fallbackSystemPrompt?.trim() || undefined;
}

function isAbortError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return error.name === "AbortError" || error.name === "TimeoutError";
}

function mapAssistantTurnStreamEventToQueryUpdate(
  event: AssistantTurnStreamEvent,
): QueryUpdate | null {
  if (event.type === "reasoning_delta") {
    return {
      addedMessages: [],
      reasoningDelta: event.delta,
    };
  }

  if (event.type === "reasoning_section_break") {
    return {
      addedMessages: [],
      reasoningSectionBreak: true,
    };
  }

  return null;
}

function appendUniqueReasoningSummaries(
  currentSummaries: string[],
  seenSummaries: Set<string>,
  nextSummaries: string[] | undefined,
): void {
  if (!nextSummaries) {
    return;
  }

  for (const summary of nextSummaries) {
    const normalizedSummary = summary.trim();
    if (!normalizedSummary || seenSummaries.has(normalizedSummary)) {
      continue;
    }

    seenSummaries.add(normalizedSummary);
    currentSummaries.push(normalizedSummary);
  }
}

function isAssistantTurnResultEmpty(result: GenerateAssistantTurnResult): boolean {
  const hasBlocks = Array.isArray(result.blocks) && result.blocks.length > 0;
  const hasReasoningSummaries = Array.isArray(result.reasoningSummaries) &&
    result.reasoningSummaries.some((summary) => summary.trim().length > 0);
  const hasRawOutputItems = Array.isArray(result.rawOutputItems) &&
    result.rawOutputItems.length > 0;

  return !hasBlocks && !hasReasoningSummaries && !hasRawOutputItems;
}

async function collectAssistantTurnWithOptionalStreaming(
  params: QueryParams,
  assistantTurnParams: GenerateAssistantTurnParams,
  pendingStreamUpdates: QueryUpdate[],
): Promise<{
  assistantTurn: GenerateAssistantTurnResult;
  streamed: boolean;
  fallbackUsed: boolean;
}> {
  if (!params.useNativeOpenAIResponses) {
    return {
      assistantTurn: await params.client.generateAssistantTurn(assistantTurnParams),
      streamed: false,
      fallbackUsed: false,
    };
  }

  try {
    const stream = params.client.streamAssistantTurn(assistantTurnParams);
    while (true) {
      const step = await stream.next();
      if (step.done) {
        if (isAssistantTurnResultEmpty(step.value)) {
          return {
            assistantTurn: await params.client.generateAssistantTurn(assistantTurnParams),
            streamed: true,
            fallbackUsed: true,
          };
        }
        return {
          assistantTurn: step.value,
          streamed: true,
          fallbackUsed: false,
        };
      }

      const streamUpdate = mapAssistantTurnStreamEventToQueryUpdate(step.value);
      if (streamUpdate) {
        pendingStreamUpdates.push(streamUpdate);
      }
    }
  } catch (error) {
    if (params.signal?.aborted || isAbortError(error)) {
      throw error;
    }

    return {
      assistantTurn: await params.client.generateAssistantTurn(assistantTurnParams),
      streamed: false,
      fallbackUsed: true,
    };
  }
}

export async function* query(
  params: QueryParams,
): AsyncGenerator<QueryUpdate, QueryResult> {
  let workingMessages = [...params.messages];
  const tools = getRegisteredTools();
  let attemptedEmptyAnswerRecovery = false;
  // Match the working Codex HTTP Responses format: replay full input items
  // rather than relying on previous_response_id continuation.
  const allowNativeResponsesContinuation = false;
  let previousResponseId = params.previousResponseId;
  const reasoningSummaries: string[] = [];
  const seenReasoningSummaries = new Set<string>();

  const shouldRequireToolOnFirstTurn = shouldForceToolUse(
    getLatestUserPrompt(workingMessages),
  );

  for (let iteration = 0; ; iteration += 1) {
    const pendingStreamUpdates: QueryUpdate[] = [];
    const isNativeResponsesContinuation = allowNativeResponsesContinuation &&
      previousResponseId !== undefined &&
      false;
    const replayMessagesForAssistantTurn: AgentMessage[] = iteration === 0
      ? buildToolSelectionMessages(workingMessages, params.systemPrompt)
      : (params.systemPrompt
        ? [{ role: "system" as const, content: params.systemPrompt }, ...workingMessages]
        : workingMessages);
    let messagesForAssistantTurn: AgentMessage[] = isNativeResponsesContinuation
      ? []
      : replayMessagesForAssistantTurn;
    let instructionsForAssistantTurn = params.useNativeOpenAIResponses
      ? buildInstructionsForAssistantTurn(
        messagesForAssistantTurn,
        params.systemPrompt,
      )
      : params.systemPrompt;

    if (params.debug) {
      yield {
        addedMessages: [],
        debugEntries: [
          `[RG_CLI][debug] query.requestContext\n${JSON.stringify({
            iteration,
            isNativeResponsesContinuation,
            previousResponseId,
            messages: messagesForAssistantTurn.map(serializeAgentMessageForDebug),
          }, null, 2)}`,
        ],
      };
    }

    const assistantTurnParams: GenerateAssistantTurnParams = {
      model: params.model,
      messages: messagesForAssistantTurn,
      tools: tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputJsonSchema,
      })),
      toolChoice: iteration === 0 && shouldRequireToolOnFirstTurn
        ? "required"
        : "auto",
      reasoningEffort: params.reasoningEffort,
      reasoningSummary: params.reasoningSummary,
      previousResponseId: undefined,
      instructions: instructionsForAssistantTurn,
      store: false,
      signal: params.signal,
    };
    let assistantTurn: GenerateAssistantTurnResult;
    let fallbackUsed: boolean;
    let streamed: boolean;
    try {
      ({
        assistantTurn,
        fallbackUsed,
        streamed,
      } = await collectAssistantTurnWithOptionalStreaming(
        params,
        assistantTurnParams,
        pendingStreamUpdates,
      ));
    } catch (error) {
      if (!isNativeResponsesContinuation) {
        throw error;
      }

      throw error;
    }

    while (pendingStreamUpdates.length > 0) {
      const streamUpdate = pendingStreamUpdates.shift();
      if (streamUpdate) {
        yield streamUpdate;
      }
    }

    previousResponseId = assistantTurn.responseId ?? previousResponseId;
    appendUniqueReasoningSummaries(
      reasoningSummaries,
      seenReasoningSummaries,
      assistantTurn.reasoningSummaries,
    );

    if (params.debug) {
      yield {
        addedMessages: [],
        debugEntries: [
          `[RG_CLI][debug] query.assistantTurnMeta\n${JSON.stringify({
            iteration,
            responseId: assistantTurn.responseId ?? null,
            reasoningSummaries: assistantTurn.reasoningSummaries ?? [],
            rawOutputItemTypes: summarizeRawOutputItemTypes(
              assistantTurn.rawOutputItems,
            ),
            streamed,
            fallbackUsed,
          }, null, 2)}`,
        ],
      };
    }

    const assistantMessage: AgentMessage = {
      role: "assistant",
      content: assistantTurn.blocks,
    };
    workingMessages = [...workingMessages, assistantMessage];
    yield {
      addedMessages: [assistantMessage],
    };

    const toolUses = extractToolUses(assistantMessage);
    if (toolUses.length === 0) {
      const assistantText = extractAssistantText(assistantMessage);
      const hasToolResults = workingMessages.some((message) =>
        Array.isArray(message.content) &&
        message.content.some((block) => block.type === "tool_result")
      );

      if (!assistantText && hasToolResults && !attemptedEmptyAnswerRecovery) {
        attemptedEmptyAnswerRecovery = true;
        const recoveryMessage: AgentMessage = {
          role: "user",
          content: EMPTY_ANSWER_RECOVERY_PROMPT,
        };
        workingMessages = [
          ...workingMessages,
          recoveryMessage,
        ];
        if (params.debug) {
          yield {
            addedMessages: [],
            debugEntries: [
              `[RG_CLI][debug] query.emptyAnswerRecoveryContext\n${JSON.stringify(
                workingMessages.map(serializeAgentMessageForDebug),
                null,
                2,
              )}`,
            ],
          };
        }
        continue;
      }

      return {
        messages: workingMessages,
        assistantText,
        reasoningSummaries: reasoningSummaries.length > 0
          ? reasoningSummaries
          : undefined,
        lastResponseId: previousResponseId,
      };
    }

    const toolResults = await runToolCalls(toolUses, {
      cwd: params.cwd,
    });

    workingMessages = [
      ...workingMessages,
      ...toolResults,
    ];
    yield {
      addedMessages: toolResults,
    };
  }

}
