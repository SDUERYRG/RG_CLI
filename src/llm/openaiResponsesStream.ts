import type {
  AssistantTurnStreamEvent,
  GenerateAssistantTurnResult,
} from "./types.ts";
import { parseSse } from "./parseSse.ts";

type StreamOpenAIResponsesAssistantTurnOptions = {
  baseUrl: string;
  urlCandidates: string[];
  headers: Record<string, string>;
  body: Record<string, unknown>;
  timeoutMs: number;
  signal?: AbortSignal;
  fetchImpl?: (
    input: string | URL | Request,
    init?: RequestInit,
  ) => Promise<Response>;
  extractResultFromPayload: (payload: unknown) => GenerateAssistantTurnResult;
};

type StreamState = {
  currentReasoningPartKey?: string;
  encounteredReasoningText: boolean;
  reasoningPartOrder: string[];
  reasoningParts: Map<string, string>;
  reasoningPartKeys: Set<string>;
  outputItemIndexesById: Map<string, number>;
  outputItems: Map<number, Record<string, unknown>>;
  outputText: string;
  responseId?: string;
  completedPayload?: unknown;
};

function parseJsonText(text: string): unknown {
  if (!text.trim()) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function isHtmlPayload(payload: unknown): payload is string {
  if (typeof payload !== "string") {
    return false;
  }

  const normalized = payload.trim().toLowerCase();
  return normalized.startsWith("<!doctype html") || normalized.startsWith("<html");
}

function getErrorMessageFromPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const error = (payload as { error?: { message?: string } }).error;
  return typeof error?.message === "string" ? error.message : null;
}

function getEventType(
  payload: Record<string, unknown>,
  fallbackEventName?: string,
): string {
  if (typeof payload.type === "string" && payload.type) {
    return payload.type;
  }

  return fallbackEventName ?? "";
}

function isSummaryTextPart(part: unknown): boolean {
  if (!part || typeof part !== "object") {
    return true;
  }

  const partType = (part as { type?: unknown }).type;
  return partType === undefined || partType === "summary_text" || partType === "text";
}

function getIndexedPartKey(payload: Record<string, unknown>): string | undefined {
  const itemId = typeof payload.item_id === "string"
    ? payload.item_id
    : typeof payload.id === "string"
    ? payload.id
    : typeof payload.response_id === "string"
    ? payload.response_id
    : undefined;
  const summaryIndex = typeof payload.summary_index === "number"
    ? payload.summary_index
    : typeof payload.index === "number"
    ? payload.index
    : undefined;
  const partIndex = typeof payload.part_index === "number"
    ? payload.part_index
    : typeof payload.content_index === "number"
    ? payload.content_index
    : undefined;

  if (
    itemId === undefined &&
    summaryIndex === undefined &&
    partIndex === undefined
  ) {
    return undefined;
  }

  return [
    itemId ?? "reasoning",
    summaryIndex ?? 0,
    partIndex ?? 0,
  ].join(":");
}

function ensureReasoningPartKey(
  payload: Record<string, unknown>,
  state: StreamState,
): string {
  const existingKey = getIndexedPartKey(payload);
  if (existingKey) {
    state.currentReasoningPartKey = existingKey;
    return existingKey;
  }

  if (state.currentReasoningPartKey) {
    return state.currentReasoningPartKey;
  }

  const fallbackKey = `reasoning:${state.reasoningPartOrder.length}`;
  state.currentReasoningPartKey = fallbackKey;
  return fallbackKey;
}

function appendReasoningDelta(
  state: StreamState,
  payload: Record<string, unknown>,
  delta: string,
): void {
  const partKey = ensureReasoningPartKey(payload, state);
  if (!state.reasoningPartKeys.has(partKey)) {
    state.reasoningPartKeys.add(partKey);
    state.reasoningPartOrder.push(partKey);
  }

  const previousText = state.reasoningParts.get(partKey) ?? "";
  state.reasoningParts.set(partKey, `${previousText}${delta}`);
}

function cloneRecord(value: Record<string, unknown>): Record<string, unknown> {
  return {
    ...value,
    ...(Array.isArray(value.content) ? { content: [...value.content] } : {}),
  };
}

function getOutputIndex(
  state: StreamState,
  payload: Record<string, unknown>,
): number {
  if (typeof payload.output_index === "number") {
    return payload.output_index;
  }

  if (typeof payload.item_id === "string") {
    const knownIndex = state.outputItemIndexesById.get(payload.item_id);
    if (knownIndex !== undefined) {
      return knownIndex;
    }
  }

  return state.outputItems.size;
}

function setOutputItem(
  state: StreamState,
  outputIndex: number,
  item: Record<string, unknown>,
): Record<string, unknown> {
  const nextItem = cloneRecord(item);
  state.outputItems.set(outputIndex, nextItem);
  if (typeof nextItem.id === "string") {
    state.outputItemIndexesById.set(nextItem.id, outputIndex);
  }
  return nextItem;
}

function ensureOutputItem(
  state: StreamState,
  payload: Record<string, unknown>,
): {
  outputIndex: number;
  item: Record<string, unknown>;
} {
  const outputIndex = getOutputIndex(state, payload);
  const existingItem = state.outputItems.get(outputIndex);
  if (existingItem) {
    if (typeof payload.item_id === "string") {
      state.outputItemIndexesById.set(payload.item_id, outputIndex);
      if (existingItem.id === undefined) {
        existingItem.id = payload.item_id;
      }
    }
    return {
      outputIndex,
      item: existingItem,
    };
  }

  const providedItem = payload.item && typeof payload.item === "object"
    ? cloneRecord(payload.item as Record<string, unknown>)
    : {
      ...(typeof payload.item_id === "string" ? { id: payload.item_id } : {}),
      type: "message",
      role: "assistant",
      content: [],
    };

  return {
    outputIndex,
    item: setOutputItem(state, outputIndex, providedItem),
  };
}

function ensureOutputContentPart(
  state: StreamState,
  payload: Record<string, unknown>,
): {
  outputIndex: number;
  item: Record<string, unknown>;
  contentIndex: number;
  part: Record<string, unknown>;
} {
  const { outputIndex, item } = ensureOutputItem(state, payload);
  const contentIndex = typeof payload.content_index === "number"
    ? payload.content_index
    : 0;
  const content = Array.isArray(item.content) ? [...item.content] : [];
  const existingPart = content[contentIndex];
  const part = existingPart && typeof existingPart === "object"
    ? { ...(existingPart as Record<string, unknown>) }
    : payload.part && typeof payload.part === "object"
    ? { ...(payload.part as Record<string, unknown>) }
    : {
      type: "output_text",
      text: "",
    };

  content[contentIndex] = part;
  item.content = content;
  state.outputItems.set(outputIndex, item);
  if (typeof item.id === "string") {
    state.outputItemIndexesById.set(item.id, outputIndex);
  }

  return {
    outputIndex,
    item,
    contentIndex,
    part,
  };
}

function tryRecordOutputItem(
  state: StreamState,
  payload: Record<string, unknown>,
): void {
  if (!("item" in payload)) {
    return;
  }

  const item = payload.item;
  if (item === undefined) {
    return;
  }

  const outputIndex = getOutputIndex(state, payload);
  if (typeof item === "object" && item !== null) {
    setOutputItem(state, outputIndex, item as Record<string, unknown>);
  }
}

function getCompletedPayload(payload: Record<string, unknown>): unknown {
  if ("response" in payload) {
    return payload.response;
  }

  if ("data" in payload) {
    return payload.data;
  }

  if ("output" in payload || "id" in payload) {
    return payload;
  }

  return undefined;
}

function buildSyntheticCompletedPayload(state: StreamState): unknown {
  const output = [...state.outputItems.entries()]
    .sort((left, right) => left[0] - right[0])
    .map((entry) => entry[1]);

  const reasoningSummaries = state.reasoningPartOrder
    .map((partKey) => state.reasoningParts.get(partKey)?.trim() ?? "")
    .filter(Boolean);

  if (reasoningSummaries.length > 0) {
    output.unshift({
      type: "reasoning",
      summary: reasoningSummaries.map((text) => ({
        type: "summary_text",
        text,
      })),
    });
  }

  if (output.length === 0 && state.outputText.trim()) {
    output.push({
      type: "message",
      content: [{
        type: "output_text",
        text: state.outputText,
      }],
    });
  }

  return {
    ...(state.responseId ? { id: state.responseId } : {}),
    output,
  };
}

function normalizeCompletedPayload(
  completedPayload: unknown,
  responseId: string | undefined,
): unknown {
  if (!completedPayload || typeof completedPayload !== "object") {
    return responseId ? { id: responseId, output: [] } : completedPayload;
  }

  const completedRecord = completedPayload as Record<string, unknown>;
  if (completedRecord.id !== undefined || responseId === undefined) {
    return completedPayload;
  }

  return {
    ...completedRecord,
    id: responseId,
  };
}

function hasUsefulAssistantTurnResult(result: GenerateAssistantTurnResult): boolean {
  return result.blocks.length > 0 ||
    (result.reasoningSummaries?.length ?? 0) > 0 ||
    (result.rawOutputItems?.length ?? 0) > 0;
}

function mergeAssistantTurnResults(
  primary: GenerateAssistantTurnResult,
  fallback: GenerateAssistantTurnResult,
): GenerateAssistantTurnResult {
  return {
    blocks: primary.blocks.length > 0 ? primary.blocks : fallback.blocks,
    reasoningSummaries: (primary.reasoningSummaries?.length ?? 0) > 0
      ? primary.reasoningSummaries
      : fallback.reasoningSummaries,
    responseId: primary.responseId ?? fallback.responseId,
    rawOutputItems: (primary.rawOutputItems?.length ?? 0) > 0
      ? primary.rawOutputItems
      : fallback.rawOutputItems,
    raw: primary.raw ?? fallback.raw,
  };
}

async function openStreamingResponse(
  options: StreamOpenAIResponsesAssistantTurnOptions,
): Promise<Response> {
  const fetchImpl = options.fetchImpl ?? fetch;
  let lastHtmlError: Error | null = null;

  for (const url of options.urlCandidates) {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        ...options.headers,
        Accept: "text/event-stream",
      },
      body: JSON.stringify({
        ...options.body,
        stream: true,
      }),
      signal: options.signal ?? AbortSignal.timeout(options.timeoutMs),
    });

    if (!response.ok) {
      const payload = parseJsonText(await response.text());
      if (isHtmlPayload(payload)) {
        lastHtmlError = new Error(
          `generateAssistantTurn returned HTML instead of JSON/SSE from ${url}.`,
        );
        continue;
      }

      const apiMessage = getErrorMessageFromPayload(payload);
      throw new Error(
        apiMessage
          ? `OpenAI-compatible responses tool turn failed: ${apiMessage}`
          : `OpenAI-compatible responses tool turn failed: HTTP ${response.status}`,
      );
    }

    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (!contentType.includes("text/event-stream")) {
      const payload = parseJsonText(await response.text());
      if (isHtmlPayload(payload)) {
        lastHtmlError = new Error(
          `generateAssistantTurn returned HTML instead of SSE from ${url}.`,
        );
        continue;
      }

      throw new Error(
        `OpenAI-compatible responses stream expected text/event-stream but received ${contentType || "unknown content-type"}.`,
      );
    }

    return response;
  }

  if (lastHtmlError) {
    throw new Error(
      `${lastHtmlError.message} Base URL may not point at an OpenAI-compatible API root: ${options.baseUrl}`,
    );
  }

  throw new Error(
    `generateAssistantTurn failed: unable to open a streaming response from ${options.baseUrl}.`,
  );
}

export async function* streamOpenAIResponsesAssistantTurn(
  options: StreamOpenAIResponsesAssistantTurnOptions,
): AsyncGenerator<AssistantTurnStreamEvent, GenerateAssistantTurnResult> {
  const response = await openStreamingResponse(options);
  if (!response.body) {
    throw new Error("OpenAI-compatible responses stream ended before a body was available.");
  }

  const state: StreamState = {
    encounteredReasoningText: false,
    reasoningPartOrder: [],
    reasoningParts: new Map(),
    reasoningPartKeys: new Set(),
    outputItemIndexesById: new Map(),
    outputItems: new Map(),
    outputText: "",
  };

  for await (const sseEvent of parseSse(response.body)) {
    if (!sseEvent.data || sseEvent.data === "[DONE]") {
      continue;
    }

    const payload = parseJsonText(sseEvent.data);
    if (!payload || typeof payload !== "object") {
      continue;
    }

    const payloadRecord = payload as Record<string, unknown>;
    const eventType = getEventType(payloadRecord, sseEvent.event);

    if (typeof payloadRecord.response_id === "string") {
      state.responseId = payloadRecord.response_id;
    }

    if (eventType === "response.reasoning_summary_part.added") {
      if (!isSummaryTextPart(payloadRecord.part)) {
        continue;
      }

      const partKey = ensureReasoningPartKey(payloadRecord, state);
      if (!state.reasoningPartKeys.has(partKey)) {
        if (state.reasoningPartOrder.length > 0 && state.encounteredReasoningText) {
          yield { type: "reasoning_section_break" };
        }
        state.reasoningPartKeys.add(partKey);
        state.reasoningPartOrder.push(partKey);
      }
      continue;
    }

    if (eventType === "response.reasoning_summary_text.delta") {
      const delta = typeof payloadRecord.delta === "string"
        ? payloadRecord.delta
        : typeof payloadRecord.text === "string"
        ? payloadRecord.text
        : "";
      if (!delta) {
        continue;
      }

      state.encounteredReasoningText = true;
      appendReasoningDelta(state, payloadRecord, delta);
      yield {
        type: "reasoning_delta",
        delta,
      };
      continue;
    }

    if (eventType === "response.output_text.delta") {
      const delta = typeof payloadRecord.delta === "string" ? payloadRecord.delta : "";
      if (!delta) {
        continue;
      }

      const { part } = ensureOutputContentPart(state, payloadRecord);
      const previousText = typeof part.text === "string" ? part.text : "";
      part.text = `${previousText}${delta}`;
      state.outputText += delta;
      yield {
        type: "output_text_delta",
        delta,
      };
      continue;
    }

    if (eventType === "response.output_item.added") {
      tryRecordOutputItem(state, payloadRecord);
      continue;
    }

    if (eventType === "response.content_part.added") {
      ensureOutputContentPart(state, payloadRecord);
      continue;
    }

    if (eventType === "response.output_text.done") {
      const text = typeof payloadRecord.text === "string" ? payloadRecord.text : "";
      if (!text) {
        continue;
      }

      const { part } = ensureOutputContentPart(state, payloadRecord);
      part.text = text;
      if (!state.outputText.trim()) {
        state.outputText = text;
      }
      continue;
    }

    if (eventType === "response.output_item.done") {
      tryRecordOutputItem(state, payloadRecord);
      continue;
    }

    if (eventType === "response.completed") {
      const completedPayload = getCompletedPayload(payloadRecord);
      if (completedPayload !== undefined) {
        state.completedPayload = completedPayload;
      }
    }
  }

  const syntheticPayload = buildSyntheticCompletedPayload(state);
  const primaryPayload = normalizeCompletedPayload(
    state.completedPayload ?? syntheticPayload,
    state.responseId,
  );
  const primaryResult = options.extractResultFromPayload(primaryPayload);
  const syntheticResult = options.extractResultFromPayload(syntheticPayload);
  if (hasUsefulAssistantTurnResult(primaryResult)) {
    return mergeAssistantTurnResults(primaryResult, syntheticResult);
  }

  return mergeAssistantTurnResults(syntheticResult, primaryResult);
}
