/**
 * 文件信息
 * 时间：2026-04-03 23:50:53 +08:00
 * 作用：负责渲染消息列表和单条消息展示。
 * 说明：把列表展示与页面状态分离，有利于以后做滚动区和消息样式扩展。
 */
import React from "react";
import { Box, Text } from "ink";
import type { ChatMessage } from "../../session/index.ts";
import { theme } from "../theme.ts";

type MessageListProps = {
  messages: ChatMessage[];
};

function MessageItem({ message }: { message: ChatMessage }) {
  const title = message.role === "user" ? "You" : "Assistant";
  const color = message.role === "user" ? theme.primary : theme.accent;

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
}

export function MessageList({ messages }: MessageListProps) {
  return (
    <Box flexDirection="column" minHeight={5}>
      {messages.map((message) => (
        <MessageItem key={message.id} message={message} />
      ))}
    </Box>
  );
}
