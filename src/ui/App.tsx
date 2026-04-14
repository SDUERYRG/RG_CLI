/**
 * 文件信息
 * 时间：2026-04-03 23:50:53 +08:00
 * 作用：定义 CLI 主界面，组合头部、消息区、输入框和底部提示。
 * 说明：页面状态集中在这里管理，具体展示拆给子组件处理。
 */
import type { AppConfig } from "../config/defaults.ts";
import React, { startTransition, useEffect, useRef, useState } from "react";
import { Box, Text, useApp } from "ink";
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
import { executeSlashCommand } from "../session/slashCommands.ts";
import { getCwd } from "../shared/cwd.ts";
import { createSerialTaskQueue } from "../shared/serialTaskQueue.ts";
import {
  formatLiveThinkingDisplayText,
  LIVE_THINKING_UPDATE_INTERVAL_MS,
} from "./liveThinking.ts";
import { Footer } from "./components/Footer.tsx";
import { MessageList } from "./components/MessageList.tsx";
import { PromptInput } from "./components/PromptInput.tsx";
import { ThinkingPanel } from "./components/ThinkingPanel.tsx";

type AppProps = {
  config: AppConfig;
};

export function App({ config }: AppProps) {
  const { exit } = useApp();
  const cwd = getCwd();
  const [activeSession, setActiveSession] = useState<PersistedChatSession>(() =>
    createChatSession(cwd, [getWelcomeMessage()])
  );
  const [isLoading, setIsLoading] = useState(false);
  const [liveCommentaryText, setLiveCommentaryText] = useState<string | undefined>();
  const [liveThinkingText, setLiveThinkingText] = useState<string | undefined>();
  const titleGenerationInFlight = useRef(new Set<string>());
  const queryEngineRef = useRef(new QueryEngine({ config }));
  const persistenceQueueRef = useRef(createSerialTaskQueue());
  const pendingLiveThinkingTextRef = useRef<string | undefined>();
  const liveThinkingFlushTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const lastLiveThinkingFlushAtRef = useRef(0);
  const messages = activeSession.messages;
  const sessionTitle = getChatSessionDisplayTitle(activeSession);
  const sessionSummary = getChatSessionDisplaySummary(activeSession);

  function flushLiveThinkingText() {
    if (liveThinkingFlushTimerRef.current) {
      clearTimeout(liveThinkingFlushTimerRef.current);
      liveThinkingFlushTimerRef.current = undefined;
    }

    lastLiveThinkingFlushAtRef.current = Date.now();
    const nextText = pendingLiveThinkingTextRef.current;
    startTransition(() => {
      setLiveThinkingText(nextText);
    });
  }

  function scheduleLiveThinkingText(
    text: string | undefined,
    options: { immediate?: boolean } = {},
  ) {
    pendingLiveThinkingTextRef.current = formatLiveThinkingDisplayText(text);

    if (options.immediate) {
      flushLiveThinkingText();
      return;
    }

    const elapsed = Date.now() - lastLiveThinkingFlushAtRef.current;
    const remaining = LIVE_THINKING_UPDATE_INTERVAL_MS - elapsed;

    if (remaining <= 0) {
      flushLiveThinkingText();
      return;
    }

    if (liveThinkingFlushTimerRef.current) {
      return;
    }

    liveThinkingFlushTimerRef.current = setTimeout(() => {
      flushLiveThinkingText();
    }, remaining);
  }

  useEffect(() => {
    return () => {
      if (liveThinkingFlushTimerRef.current) {
        clearTimeout(liveThinkingFlushTimerRef.current);
      }
    };
  }, []);

  async function persistSession(session: PersistedChatSession): Promise<void> {
    await persistenceQueueRef.current.enqueue(async () => {
      try {
        await saveSessionSnapshot(session);
      } catch {
        // 持久化失败不阻断当前聊天流程；后续可以再补专门的错误提示。
      }
    });
  }

  function createFreshSession(): PersistedChatSession {
    return createChatSession(cwd, [getWelcomeMessage()]);
  }

  function replaceActiveSession(session: PersistedChatSession): void {
    syncMessageIdSequence(session.messages);
    setActiveSession(session);
    setLiveCommentaryText(undefined);
    scheduleLiveThinkingText(undefined, { immediate: true });
  }

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

        const updatedSession = await persistenceQueueRef.current.enqueue(() =>
          saveAiSessionTitleIfNoCustomTitle(
            session.cwd,
            session.id,
            generatedTitle,
          )
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
        // AI 标题生成失败不影响主对话流程。
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
      return;
    }

    setIsLoading(true);
    setLiveCommentaryText(undefined);
    scheduleLiveThinkingText(undefined, { immediate: true });
    let latestSession = activeSession;

    try {
      for await (const step of queryEngineRef.current.submitMessage(
        activeSession,
        nextValue,
      )) {
        const sessionChanged = latestSession !== step.session;
        latestSession = step.session;

        if (sessionChanged) {
          setActiveSession(step.session);
        }

        setLiveCommentaryText(step.liveCommentaryText);

        scheduleLiveThinkingText(step.liveThinkingText, {
          immediate: step.persist || step.liveThinkingText === undefined,
        });

        if (step.persist) {
          await persistSession(step.session);
        }
      }
      maybeGenerateAiTitle(latestSession);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const latestMessage = latestSession.messages.at(-1);
      const fallbackUserMessage = latestMessage?.role === "user" &&
          latestMessage.content === nextValue
        ? latestSession
        : updateChatSessionMessages(latestSession, [
          ...latestSession.messages,
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
      setLiveCommentaryText(undefined);
      scheduleLiveThinkingText(undefined, { immediate: true });
      await persistSession(sessionAfterFailureReply);
    } finally {
      setIsLoading(false);
      setLiveCommentaryText(undefined);
      scheduleLiveThinkingText(undefined, { immediate: true });
    }
  }

  function handleSubmit(value: string) {
    void submitUserMessage(value);
  }

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Box flexDirection="column" marginBottom={1}>
        <Box justifyContent="space-between">
          <Text bold>{`当前会话：${sessionTitle}`}</Text>
          <Text dimColor>
            按 <Text color="blueBright" bold>Q</Text> 退出，或按{" "}
            <Text color="blueBright" bold>Ctrl+C</Text> 强制退出
          </Text>
        </Box>
        <Text dimColor>{`摘要：${sessionSummary}`}</Text>
      </Box>
      <MessageList
        key={activeSession.id}
        messages={messages}
        transcriptKey={activeSession.id}
      />
      <ThinkingPanel text={liveThinkingText} isLoading={isLoading} />
      <Footer
        isLoading={isLoading}
        commentaryText={liveCommentaryText}
      />
      <PromptInput
        onSubmit={handleSubmit}
        onExitRequest={exit}
        isBusy={isLoading}
      />
    </Box>
  );
}
