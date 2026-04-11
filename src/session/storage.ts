/**
 * 文件信息
 * 时间：2026-04-10 00:00:00 +08:00
 * 作用：提供会话持久化、会话列表和会话恢复能力。
 * 说明：实现思路借鉴 claude-code 的 sessionStorage：
 * 1. 使用独立 sessionId 区分不同会话。
 * 2. 按“项目目录”分组存储不同会话。
 * 3. 每个会话单独落盘，而不是只保存一个全局 latest 文件。
 * 4. 恢复时先列出会话，再读取具体会话内容。
 */
import { randomUUID, createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import { writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { getRgCliConfigHomeDir } from "../utils/envUtils.ts";
import type { AgentMessage, ChatMessage } from "./types.ts";

const SESSION_FILE_SUFFIX = ".json";
const MAX_TITLE_LENGTH = 36;
const MAX_SUMMARY_LENGTH = 96;

export type PersistedChatSession = {
  version: 4;
  id: string;
  cwd: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
  agentMessages: AgentMessage[];
  lastResponsesResponseId?: string;
  customTitle?: string;
  aiTitle?: string;
  firstPrompt?: string;
  lastPrompt?: string;
  sessionSummary?: string;
};

export type ChatSessionSummary = {
  id: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  title: string;
  summary: string;
};

type LiteSessionFile = {
  id: string;
  filePath: string;
  mtimeMs: number;
};

type LegacyPersistedChatSession = {
  version?: 1 | 2 | 3 | 4;
  id: string;
  cwd: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
  agentMessages?: AgentMessage[];
  lastResponsesResponseId?: string;
  customTitle?: string;
  generatedTitle?: string;
  aiTitle?: string;
  firstPrompt?: string;
  lastPrompt?: string;
  summary?: string;
  sessionSummary?: string;
};

export type ResolveSessionResult =
  | { status: "found"; session: PersistedChatSession }
  | { status: "not-found" }
  | { status: "ambiguous"; matches: ChatSessionSummary[] };

export function getProjectsDir(): string {
  return join(getRgCliConfigHomeDir(), "projects");
}

function getProjectKey(cwd: string): string {
  return createHash("sha1")
    .update(cwd.normalize("NFC"))
    .digest("hex");
}

export function getProjectDir(cwd: string): string {
  return join(getProjectsDir(), getProjectKey(cwd));
}

export function getSessionFilePath(cwd: string, sessionId: string): string {
  return join(getProjectDir(cwd), `${sessionId}${SESSION_FILE_SUFFIX}`);
}

export function createChatSession(
  cwd: string,
  messages: ChatMessage[],
): PersistedChatSession {
  const now = new Date().toISOString();

  return withDerivedSessionMetadata({
    version: 4,
    id: randomUUID(),
    cwd,
    createdAt: now,
    updatedAt: now,
    messages,
  });
}

export function updateChatSessionMessages(
  session: PersistedChatSession,
  messages: ChatMessage[],
): PersistedChatSession {
  return withDerivedSessionMetadata({
    ...session,
    messages,
    updatedAt: new Date().toISOString(),
  });
}

export function updateChatSessionCustomTitle(
  session: PersistedChatSession,
  customTitle: string | undefined,
): PersistedChatSession {
  return withDerivedSessionMetadata({
    ...session,
    customTitle,
    updatedAt: new Date().toISOString(),
  });
}

function ensureProjectDirExists(cwd: string): void {
  mkdirSync(getProjectDir(cwd), { recursive: true });
}

function isPersistableSession(session: PersistedChatSession): boolean {
  return session.messages.some((message) => message.role === "user");
}

function deriveAgentMessagesFromChatMessages(
  messages: ChatMessage[],
): AgentMessage[] {
  return messages
    .filter((message) => message.includeInContext !== false && message.content.trim())
    .map((message) => ({
      role: message.role,
      content: message.content,
    }));
}

function readSessionFile(filePath: string): PersistedChatSession | null {
  try {
    const raw = readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as LegacyPersistedChatSession;

    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    if (typeof parsed.id !== "string" || !Array.isArray(parsed.messages)) {
      return null;
    }

    return withDerivedSessionMetadata(parsed);
  } catch {
    return null;
  }
}

function normalizeSnippet(text: string, maxLength: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength).trim()}...`;
}

function getContextualMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.filter((message) =>
    message.includeInContext !== false && message.content.trim().length > 0
  );
}

function deriveFirstPrompt(messages: ChatMessage[]): string | undefined {
  const firstUserMessage = getContextualMessages(messages).find((message) =>
    message.role === "user"
  );

  return firstUserMessage?.content.trim();
}

function deriveLastPrompt(messages: ChatMessage[]): string | undefined {
  const userMessages = getContextualMessages(messages).filter((message) =>
    message.role === "user"
  );

  return userMessages.at(-1)?.content.trim();
}

function deriveSessionSummary(messages: ChatMessage[]): string | undefined {
  const contextualMessages = getContextualMessages(messages);
  const lastAssistantMessage = [...contextualMessages]
    .reverse()
    .find((message) => message.role === "assistant");

  if (lastAssistantMessage) {
    return normalizeSnippet(lastAssistantMessage.content, MAX_SUMMARY_LENGTH);
  }

  return undefined;
}

function getDisplayTitle(session: PersistedChatSession): string {
  return session.customTitle?.trim() ||
    session.aiTitle?.trim() ||
    session.firstPrompt?.trim() ||
    "(session)";
}

function getListSummary(session: PersistedChatSession): string {
  return session.lastPrompt?.trim() ||
    session.sessionSummary?.trim() ||
    session.firstPrompt?.trim() ||
    getDisplayTitle(session);
}

function getDisplaySummary(session: PersistedChatSession): string {
  return session.sessionSummary?.trim() ||
    session.lastPrompt?.trim() ||
    session.firstPrompt?.trim() ||
    "(暂无摘要)";
}

function withDerivedSessionMetadata(
  session: LegacyPersistedChatSession,
): PersistedChatSession {
  const {
    generatedTitle: legacyGeneratedTitle,
    summary: legacySummary,
    version: _legacyVersion,
    ...rest
  } = session;
  const customTitle = session.customTitle?.trim() || undefined;
  const firstPrompt = deriveFirstPrompt(session.messages) ||
    session.firstPrompt?.trim() ||
    undefined;
  const lastPrompt = deriveLastPrompt(session.messages) ||
    session.lastPrompt?.trim() ||
    undefined;
  const aiTitle = session.aiTitle?.trim() ||
    legacyGeneratedTitle?.trim() ||
    undefined;
  const lastResponsesResponseId = session.lastResponsesResponseId?.trim() ||
    undefined;
  const sessionSummary = deriveSessionSummary(session.messages) ||
    session.sessionSummary?.trim() ||
    legacySummary?.trim() ||
    undefined;
  const agentMessages = session.agentMessages && session.agentMessages.length > 0
    ? session.agentMessages
    : deriveAgentMessagesFromChatMessages(session.messages);

  return {
    ...rest,
    version: 4,
    agentMessages,
    lastResponsesResponseId,
    customTitle,
    aiTitle,
    firstPrompt,
    lastPrompt,
    sessionSummary,
  };
}

function getSessionFilesLite(cwd: string): LiteSessionFile[] {
  const projectDir = getProjectDir(cwd);

  if (!existsSync(projectDir)) {
    return [];
  }

  return readdirSync(projectDir)
    .filter((fileName) => fileName.endsWith(SESSION_FILE_SUFFIX))
    .map((fileName) => {
      const filePath = join(projectDir, fileName);
      const stats = statSync(filePath);

      return {
        id: basename(fileName, SESSION_FILE_SUFFIX),
        filePath,
        mtimeMs: stats.mtimeMs,
      };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
}

function enrichSessionSummary(file: LiteSessionFile): ChatSessionSummary | null {
  const session = readSessionFile(file.filePath);

  if (!session) {
    return null;
  }

  return {
    id: session.id,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    messageCount: session.messages.length,
    title: getDisplayTitle(session),
    summary: getListSummary(session),
  };
}

export async function saveSessionSnapshot(
  session: PersistedChatSession,
): Promise<void> {
  if (!isPersistableSession(session)) {
    return;
  }

  ensureProjectDirExists(session.cwd);

  const filePath = getSessionFilePath(session.cwd, session.id);
  await writeFile(
    filePath,
    JSON.stringify(session, null, 2),
    "utf8",
  );
}

export async function saveAiSessionTitleIfNoCustomTitle(
  cwd: string,
  sessionId: string,
  aiTitle: string,
): Promise<PersistedChatSession | null> {
  const normalizedTitle = aiTitle.trim();

  if (!normalizedTitle) {
    return null;
  }

  const session = loadSessionById(cwd, sessionId);

  if (!session || session.customTitle?.trim()) {
    return null;
  }

  if (session.aiTitle?.trim() === normalizedTitle) {
    return session;
  }

  const updatedSession = updateChatSessionAiTitle(session, normalizedTitle);
  await saveSessionSnapshot(updatedSession);
  return updatedSession;
}

export function listPersistedSessions(
  cwd: string,
  limit = 20,
): ChatSessionSummary[] {
  return getSessionFilesLite(cwd)
    .slice(0, limit)
    .map(enrichSessionSummary)
    .filter((summary): summary is ChatSessionSummary => summary !== null);
}

export function getChatSessionDisplayTitle(
  session: PersistedChatSession,
): string {
  return getDisplayTitle(session);
}

export function getChatSessionDisplaySummary(
  session: PersistedChatSession,
): string {
  return getDisplaySummary(session);
}

export function updateChatSessionAiTitle(
  session: PersistedChatSession,
  aiTitle: string | undefined,
): PersistedChatSession {
  return {
    ...session,
    version: 4,
    aiTitle,
    updatedAt: new Date().toISOString(),
  };
}

export function updateChatSessionAgentMessages(
  session: PersistedChatSession,
  agentMessages: AgentMessage[],
): PersistedChatSession {
  return {
    ...session,
    version: 4,
    agentMessages,
    updatedAt: new Date().toISOString(),
  };
}

export function updateChatSessionLastResponsesResponseId(
  session: PersistedChatSession,
  responseId: string | undefined,
): PersistedChatSession {
  return {
    ...session,
    version: 4,
    lastResponsesResponseId: responseId,
    updatedAt: new Date().toISOString(),
  };
}

export function loadSessionById(
  cwd: string,
  sessionId: string,
): PersistedChatSession | null {
  return readSessionFile(getSessionFilePath(cwd, sessionId));
}

export function loadMostRecentSession(cwd: string): PersistedChatSession | null {
  const latestFile = getSessionFilesLite(cwd)[0];

  if (!latestFile) {
    return null;
  }

  return readSessionFile(latestFile.filePath);
}

export function resolveSession(
  cwd: string,
  query: string,
): ResolveSessionResult {
  const trimmedQuery = query.trim();

  if (!trimmedQuery) {
    return { status: "not-found" };
  }

  const summaries = listPersistedSessions(cwd, 100);
  const exactMatch = summaries.find((summary) => summary.id === trimmedQuery);

  if (exactMatch) {
    const session = loadSessionById(cwd, exactMatch.id);
    return session
      ? { status: "found", session }
      : { status: "not-found" };
  }

  const prefixMatches = summaries.filter((summary) =>
    summary.id.startsWith(trimmedQuery)
  );

  if (prefixMatches.length === 0) {
    return { status: "not-found" };
  }

  if (prefixMatches.length > 1) {
    return {
      status: "ambiguous",
      matches: prefixMatches.slice(0, 5),
    };
  }

  const session = loadSessionById(cwd, prefixMatches[0]!.id);
  return session
    ? { status: "found", session }
    : { status: "not-found" };
}
