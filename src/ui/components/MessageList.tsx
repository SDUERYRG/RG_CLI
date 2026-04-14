/**
 * 文件信息
 * 时间：2026-04-03 23:50:53 +08:00
 * 作用：负责渲染消息列表和单条消息展示。
 * 说明：把列表展示与页面状态分离，有利于以后做滚动区和消息样式扩展。
 */
import React, { useLayoutEffect, useRef, useState } from "react";
import { Box, Static, Text } from "ink";
import type { ChatMessage } from "../../session/index.ts";
import { Header } from "./Header.tsx";
import { theme } from "../theme.ts";

type MessageListProps = {
  messages: ChatMessage[];
  transcriptKey?: string;
};

type MessageListReconciliation =
  | { mode: "noop"; messages: ChatMessage[] }
  | { mode: "append"; messages: ChatMessage[] }
  | { mode: "reset"; messages: ChatMessage[] };

export function reconcileStaticMessages(
  previousMessages: ChatMessage[],
  nextMessages: ChatMessage[],
): MessageListReconciliation {
  if (previousMessages.length > nextMessages.length) {
    return {
      mode: "reset",
      messages: nextMessages,
    };
  }

  for (const [index, previousMessage] of previousMessages.entries()) {
    if (nextMessages[index]?.id !== previousMessage.id) {
      return {
        mode: "reset",
        messages: nextMessages,
      };
    }
  }

  if (previousMessages.length === nextMessages.length) {
    return {
      mode: "noop",
      messages: [],
    };
  }

  return {
    mode: "append",
    messages: nextMessages.slice(previousMessages.length),
  };
}

export const MessageItem = React.memo(function MessageItem({ message }: {
  message: ChatMessage;
}) {
  const title = message.kind === "tool_call"
    ? "Tool Call"
    : message.kind === "tool_result"
    ? "Tool Result"
    : message.kind === "debug"
    ? "Debug"
    : message.kind === "thinking"
    ? "Thinking"
    : message.role === "user"
    ? "You"
    : "Assistant";
  const color = message.kind === "tool_call"
    ? theme.warning
    : message.kind === "tool_result"
    ? theme.secondary
    : message.kind === "debug"
    ? theme.debug
    : message.kind === "thinking"
    ? theme.thinking
    : message.role === "user"
    ? theme.primary
    : theme.accent;

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text color={color} bold>
        {title}
      </Text>
      <Box paddingLeft={2}>
        <Text>{message.content}</Text>
      </Box>
    </Box>
  );
});

export const MessageList = React.memo(function MessageList({
  messages,
  transcriptKey,
}: MessageListProps) {
  const sessionKey = transcriptKey ?? "default";
  const [staticMessages, setStaticMessages] = useState<ChatMessage[]>(() => messages);
  const staticMessagesRef = useRef(staticMessages);

  useLayoutEffect(() => {
    const reconciliation = reconcileStaticMessages(staticMessagesRef.current, messages);

    if (reconciliation.mode === "noop") {
      return;
    }

    if (reconciliation.mode === "reset") {
      staticMessagesRef.current = reconciliation.messages;
      setStaticMessages(reconciliation.messages);
      return;
    }

    const nextStaticMessages = [
      ...staticMessagesRef.current,
      ...reconciliation.messages,
    ];
    staticMessagesRef.current = nextStaticMessages;
    setStaticMessages(nextStaticMessages);
  }, [messages]);

  return (
    <Box key={sessionKey} flexDirection="column">
      <Header />
      <Static items={staticMessages}>
        {(message) => <MessageItem key={message.id} message={message} />}
      </Static>
    </Box>
  );
});
