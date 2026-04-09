/**
 * 文件信息
 * 时间：2026-04-03 23:50:53 +08:00
 * 作用：定义 CLI 主界面，组合头部、消息区、输入框和底部提示。
 * 说明：页面状态集中在这里管理，具体展示拆给子组件处理。
 */
import type { AppConfig } from "../config/defaults.ts";
import { createLlmClient } from "../llm/createClient.ts";
import { executeSlashCommand } from "../session/slashCommands.ts";
import React, { useState } from "react";
import { Box, useApp, useInput } from "ink";
import { Footer } from "./components/Footer.tsx";
import { Header } from "./components/Header.tsx";
import { MessageList } from "./components/MessageList.tsx";
import { PromptInput } from "./components/PromptInput.tsx";
import {
  createAssistantReply,
  createMessage,
  getWelcomeMessage,
} from "../session/index.ts";
import type { ChatMessage } from "../session/index.ts";

type AppProps = {
  config: AppConfig;
};

export function App({ config }: AppProps) {
  const { exit } = useApp();
  const [query, setQuery] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>(() => [
    getWelcomeMessage(),
  ]);
  const [isLoading, setIsLoading] = useState(false);

  useInput((input, key) => {
    const wantsToExit = (query.length === 0 && input.toLowerCase() === "q") ||
      (key.ctrl && input === "c");

    if (wantsToExit) {
      exit();
    }
  });

  async function submitUserMessage(value: string) {
    const nextValue = value.trim();

    if (!nextValue || isLoading) {
      return;
    }

    const slashResult = executeSlashCommand(nextValue);

    if (slashResult.type !== "not-a-command") {
      if (slashResult.type === "append-messages") {
        setMessages((currentMessages) => [
          ...currentMessages,
          ...slashResult.messages,
        ]);
      }

      if (slashResult.type === "replace-messages") {
        setMessages(slashResult.messages);
      }

      if (slashResult.type === "exit") {
        exit();
      }

      setQuery("");
      return;
    }

    const userMessage = createMessage("user", nextValue);
    setMessages((currentMessages) => [
      ...currentMessages,
      userMessage,
    ]);
    setQuery("");
    setIsLoading(true);

    try {
      const client = createLlmClient(config);
      const result = await client.generateText({
        model: config.model,
        prompt: nextValue,
      });

      setMessages((currentMessages) => [
        ...currentMessages,
        createAssistantReply(result.text),
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setMessages((currentMessages) => [
        ...currentMessages,
        createAssistantReply(`模型请求失败：${message}`),
      ]);
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
