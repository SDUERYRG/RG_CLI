/**
 * 文件信息
 * 时间：2026-04-10 00:00:00 +08:00
 * 作用：为会话生成 AI 标题。
 * 说明：设计思路借鉴 claude-code 的 sessionTitle.ts：
 * 1. 独立模块，避免和 UI 强耦合。
 * 2. 使用单独 prompt 异步生成标题。
 * 3. 失败时返回 null，不影响主会话流程。
 */
import type { AppConfig } from "../config/defaults.ts";
import { createLlmClient } from "../llm/createClient.ts";
import type { LlmMessage } from "../llm/types.ts";
import type { PersistedChatSession } from "./storage.ts";

const MAX_CONVERSATION_TEXT = 1000;
const MAX_TITLE_LENGTH = 36;

const SESSION_TITLE_SYSTEM_PROMPT = [
  "你是一个会话标题生成器。",
  "请根据这次编程会话的核心目标，生成一个简洁、自然、句子式大小写的中文标题。",
  "标题控制在 3 到 10 个词以内，尽量让用户在会话列表里一眼认出主题。",
  "不要加引号，不要加句号，不要写“会话”或“对话”，不要输出多行。",
  "优先概括用户正在解决的问题或正在实现的功能。",
  "如果输入信息不足，就尽量根据已有内容生成最具体的标题。",
  "只返回标题本身。",
].join("\n");

function normalizeTitle(title: string): string | null {
  const normalized = title
    .replace(/^\s*["'“”‘’]+/, "")
    .replace(/["'“”‘’]+\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) {
    return null;
  }

  if (normalized.length <= MAX_TITLE_LENGTH) {
    return normalized;
  }

  return `${normalized.slice(0, MAX_TITLE_LENGTH).trim()}...`;
}

export function extractConversationText(
  session: PersistedChatSession,
): string {
  const parts: string[] = [];

  for (const message of session.messages) {
    if (message.includeInContext === false) {
      continue;
    }

    if (message.role !== "user" && message.role !== "assistant") {
      continue;
    }

    const text = message.content.trim();
    if (!text) {
      continue;
    }

    const prefix = message.role === "user" ? "用户" : "助手";
    parts.push(`${prefix}: ${text}`);
  }

  const combined = parts.join("\n");
  if (combined.length <= MAX_CONVERSATION_TEXT) {
    return combined;
  }

  return combined.slice(-MAX_CONVERSATION_TEXT);
}

export async function generateSessionAiTitle(
  config: AppConfig,
  session: PersistedChatSession,
  signal: AbortSignal,
): Promise<string | null> {
  const conversationText = extractConversationText(session).trim();

  if (!conversationText) {
    return null;
  }

  try {
    const client = createLlmClient(config);
    const result = await client.generateText({
      model: config.model,
      messages: [
        {
          role: "system",
          content: SESSION_TITLE_SYSTEM_PROMPT,
        },
        {
          role: "user",
          content: conversationText,
        },
      ] satisfies LlmMessage[],
      signal,
    });

    return normalizeTitle(result.text);
  } catch {
    return null;
  }
}
