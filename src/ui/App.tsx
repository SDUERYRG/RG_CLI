/**
 * 文件信息
 * 时间：2026-04-03 23:50:53 +08:00
 * 作用：定义 CLI 主界面，组合头部、消息区、输入框和底部提示。
 * 说明：页面状态集中在这里管理，具体展示拆给子组件处理。
 */
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
} from "./lib/messages.ts";
import type { ChatMessage } from "./types.ts";

export function App() {
  const { exit } = useApp();
  const [query, setQuery] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>(() => [
    getWelcomeMessage(),
  ]);

  useInput((input, key) => {
    const wantsToExit = (query.length === 0 && input.toLowerCase() === "q") ||
      (key.ctrl && input === "c");

    if (wantsToExit) {
      exit();
    }
  });

  function handleSubmit(value: string) {
    const nextValue = value.trim();

    if (!nextValue) {
      return;
    }

    const userMessage = createMessage("user", nextValue);
    const assistantMessage = createAssistantReply(nextValue);

    setMessages((currentMessages) => [
      ...currentMessages,
      userMessage,
      assistantMessage,
    ]);
    setQuery("");
  }

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Header />
      <MessageList messages={messages} />
      <PromptInput value={query} onChange={setQuery} onSubmit={handleSubmit} />
      <Footer />
    </Box>
  );
}
