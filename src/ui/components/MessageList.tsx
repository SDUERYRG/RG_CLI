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
  transientMessages?: ChatMessage[];
  transcriptKey?: string;
};

const MAX_DYNAMIC_MESSAGES = 12;

type MessageListReconciliation =
  | { mode: "noop"; staticMessages: ChatMessage[] }
  | { mode: "append"; staticMessages: ChatMessage[] }
  | { mode: "reset"; staticMessages: ChatMessage[] };

function areMessagesEquivalent(
  left: ChatMessage,
  right: ChatMessage,
): boolean {
  return left.id === right.id &&
    left.kind === right.kind &&
    left.content === right.content &&
    left.toolCallId === right.toolCallId;
}

export function reconcileStaticMessages(
  previousStaticMessages: ChatMessage[],
  nextMessages: ChatMessage[],
  maxDynamicMessages = MAX_DYNAMIC_MESSAGES,
): MessageListReconciliation {
  const nextStaticMessages = nextMessages.slice(
    0,
    Math.max(0, nextMessages.length - maxDynamicMessages),
  );

  if (previousStaticMessages.length > nextStaticMessages.length) {
    return {
      mode: "reset",
      staticMessages: nextStaticMessages,
    };
  }

  for (const [index, previousStaticMessage] of previousStaticMessages.entries()) {
    const nextStaticMessage = nextStaticMessages[index];
    if (!nextStaticMessage || !areMessagesEquivalent(previousStaticMessage, nextStaticMessage)) {
      return {
        mode: "reset",
        staticMessages: nextStaticMessages,
      };
    }
  }

  if (previousStaticMessages.length === nextStaticMessages.length) {
    return {
      mode: "noop",
      staticMessages: [],
    };
  }

  return {
    mode: "append",
    staticMessages: nextStaticMessages.slice(previousStaticMessages.length),
  };
}

export const MessageItem = React.memo(function MessageItem({ message }: {
  message: ChatMessage;
}) {
  if (message.kind === "commentary") {
    return (
      <Box marginBottom={0}>
        <Text color={theme.secondary} dimColor>
          • {message.content}
        </Text>
      </Box>
    );
  }

  if (message.kind === "tool_call") {
    const [headline, ...details] = message.content.split(/\r?\n/);

    return (
      <Box flexDirection="column" marginBottom={1}>
        <Text color={theme.warning} bold>
          › {headline}
        </Text>
        {details.length > 0
          ? (
            <Box flexDirection="column" paddingLeft={2}>
              {details.map((line, index) => (
                <Text key={`${message.id}:${index}`} color={theme.warning}>
                  {line || " "}
                </Text>
              ))}
            </Box>
          )
          : null}
      </Box>
    );
  }

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
  transientMessages = [],
  transcriptKey,
}: MessageListProps) {
  const sessionKey = transcriptKey ?? "default";
  const [staticMessages, setStaticMessages] = useState<ChatMessage[]>(() =>
    messages.slice(0, Math.max(0, messages.length - MAX_DYNAMIC_MESSAGES))
  );
  const [staticResetVersion, setStaticResetVersion] = useState(0);
  const staticMessagesRef = useRef(staticMessages);

  useLayoutEffect(() => {
    const reconciliation = reconcileStaticMessages(staticMessagesRef.current, messages);

    if (reconciliation.mode === "noop") {
      return;
    }

    if (reconciliation.mode === "reset") {
      staticMessagesRef.current = reconciliation.staticMessages;
      setStaticMessages(reconciliation.staticMessages);
      setStaticResetVersion((currentVersion) => currentVersion + 1);
      return;
    }

    const nextStaticMessages = [
      ...staticMessagesRef.current,
      ...reconciliation.staticMessages,
    ];
    staticMessagesRef.current = nextStaticMessages;
    setStaticMessages(nextStaticMessages);
  }, [messages]);

  const dynamicMessages = messages.slice(staticMessages.length);

  return (
    <Box key={sessionKey} flexDirection="column">
      <Header />
      <Static key={`${sessionKey}:${staticResetVersion}`} items={staticMessages}>
        {(message) => <MessageItem key={message.id} message={message} />}
      </Static>
      {dynamicMessages.map((message) => (
        <MessageItem key={message.id} message={message} />
      ))}
      {transientMessages.map((message) => (
        <MessageItem key={message.id} message={message} />
      ))}
    </Box>
  );
});
