/**
 * 文件信息
 * 时间：2026-04-03 23:50:53 +08:00
 * 作用：定义 CLI 主界面，组合头部、消息区、输入框和底部提示。
 * 说明：页面状态集中在这里管理，具体展示拆给子组件处理。
 */
import type { AppConfig } from "../config/defaults.ts";
import { executeSlashCommand } from "../session/slashCommands.ts";
import React, { useRef, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { Footer } from "./components/Footer.tsx";
import { Header } from "./components/Header.tsx";
import { MessageList } from "./components/MessageList.tsx";
import { PromptInput } from "./components/PromptInput.tsx";
import {
  createAssistantReply,
  createChatSession,
  createMessage,
  generateSessionAiTitle,
  getChatSessionDisplaySummary,
  getChatSessionDisplayTitle,
  getWelcomeMessage,
  QueryEngine,
  saveAiSessionTitleIfNoCustomTitle,
  saveSessionSnapshot,
  syncMessageIdSequence,
  updateChatSessionCustomTitle,
  updateChatSessionMessages,
} from "../session/index.ts";
import type { PersistedChatSession } from "../session/index.ts";
import { getCwd } from "../shared/cwd.ts";

type AppProps = {
  config: AppConfig;
};

export function App({ config }: AppProps) {
  const { exit } = useApp();
  const cwd = getCwd();
  const [query, setQuery] = useState("");
  const [activeSession, setActiveSession] = useState<PersistedChatSession>(() =>
    createChatSession(cwd, [getWelcomeMessage()])
  );
  const [isLoading, setIsLoading] = useState(false);
  const titleGenerationInFlight = useRef(new Set<string>());
  const queryEngineRef = useRef(new QueryEngine({ config }));
  const messages = activeSession.messages;
  const sessionTitle = getChatSessionDisplayTitle(activeSession);
  const sessionSummary = getChatSessionDisplaySummary(activeSession);

  async function persistSession(session: PersistedChatSession): Promise<void> {
    try {
      await saveSessionSnapshot(session);
    } catch {
      // 持久化失败不阻断当前聊天流程；后续可以再补专门的错误提示。
    }
  }

  function createFreshSession(): PersistedChatSession {
    return createChatSession(cwd, [getWelcomeMessage()]);
  }

  function replaceActiveSession(session: PersistedChatSession): void {
    syncMessageIdSequence(session.messages);
    setActiveSession(session);
    setQuery("");
  }

  useInput((input, key) => {
    const wantsToExit = (query.length === 0 && input.toLowerCase() === "q") ||
      (key.ctrl && input === "c");

    if (wantsToExit) {
      exit();
    }
  });

  function maybeGenerateAiTitle(session: PersistedChatSession): void {
    const contextualMessages = session.messages.filter((message) =>
      message.includeInContext !== false
    );
    const userCount = contextualMessages.filter((message) =>
      message.role === "user"
    ).length;
    const assistantCount = contextualMessages.filter((message) =>
      message.role === "assistant"
    ).length;

    if (session.customTitle?.trim() || session.aiTitle?.trim()) {
      return;
    }

    if (userCount !== 1 || assistantCount !== 1) {
      return;
    }

    if (titleGenerationInFlight.current.has(session.id)) {
      return;
    }

    titleGenerationInFlight.current.add(session.id);

    void (async () => {
      try {
        const signal = AbortSignal.timeout(15_000);
        const generatedTitle = await generateSessionAiTitle(config, session, signal);

        if (!generatedTitle) {
          return;
        }

        const updatedSession = await saveAiSessionTitleIfNoCustomTitle(
          session.cwd,
          session.id,
          generatedTitle,
        );

        if (!updatedSession) {
          return;
        }

        syncMessageIdSequence(updatedSession.messages);
        setActiveSession((currentSession) => {
          if (currentSession.id !== updatedSession.id || currentSession.customTitle?.trim()) {
            return currentSession;
          }

          return updatedSession;
        });
      } catch {
        // AI 标题生成失败不影响主对话流程
      } finally {
        titleGenerationInFlight.current.delete(session.id);
      }
    })();
  }

  async function submitUserMessage(value: string) {
    const nextValue = value.trim();

    if (!nextValue || isLoading) {
      return;
    }

    const slashResult = executeSlashCommand(nextValue, {
      cwd,
      activeSessionId: activeSession.id,
    });

    if (slashResult.type !== "not-a-command") {
      if (slashResult.type === "append-messages") {
        setActiveSession((currentSession) =>
          updateChatSessionMessages(currentSession, [
            ...currentSession.messages,
            ...slashResult.messages,
          ])
        );
      }

      if (slashResult.type === "replace-messages") {
        setActiveSession((currentSession) =>
          updateChatSessionMessages(currentSession, slashResult.messages)
        );
      }

      if (slashResult.type === "start-new-session") {
        replaceActiveSession(createFreshSession());
      }

      if (slashResult.type === "load-session") {
        replaceActiveSession(slashResult.session);
      }

      if (slashResult.type === "rename-session") {
        const renamedSession = updateChatSessionCustomTitle(activeSession, slashResult.title);
        const renamedSessionWithAck = updateChatSessionMessages(renamedSession, [
          ...renamedSession.messages,
          ...slashResult.messages,
        ]);
        setActiveSession(renamedSessionWithAck);
        await persistSession(renamedSessionWithAck);
      }

      if (slashResult.type === "exit") {
        exit();
      }

      setQuery("");
      return;
    }

    setQuery("");
    setIsLoading(true);

    try {
      let sessionAfterAssistantReply = activeSession;
      for await (const sessionUpdate of queryEngineRef.current.submitMessage(
        activeSession,
        nextValue,
      )) {
        sessionAfterAssistantReply = sessionUpdate;
        setActiveSession(sessionUpdate);
        void persistSession(sessionUpdate);
      }
      maybeGenerateAiTitle(sessionAfterAssistantReply);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const fallbackUserMessage = updateChatSessionMessages(activeSession, [
        ...messages,
        createMessage("user", nextValue),
      ]);
      const sessionAfterFailureReply = updateChatSessionMessages(
        fallbackUserMessage,
        [
          ...fallbackUserMessage.messages,
          createAssistantReply(`模型请求失败：${message}`, {
            includeInContext: false,
          }),
        ],
      );

      setActiveSession(sessionAfterFailureReply);
      await persistSession(sessionAfterFailureReply);
    } finally {
      setIsLoading(false);
    }
  }

  function handleSubmit(value: string) {
    void submitUserMessage(value);
  }


  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Header />
      <Box flexDirection="column" marginBottom={1}>
        <Text bold>当前会话：{sessionTitle}</Text>
        <Text dimColor>摘要：{sessionSummary}</Text>
      </Box>
      <MessageList messages={messages} />
      <PromptInput
        value={query}
        onChange={setQuery}
        onSubmit={handleSubmit}
        isBusy={isLoading}
      />
      <Footer isLoading={isLoading} />
    </Box>
  );
}
