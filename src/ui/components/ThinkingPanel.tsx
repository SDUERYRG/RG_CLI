import React from "react";
import { Box, Text } from "ink";
import { theme } from "../theme.ts";

type ThinkingPanelProps = {
  text?: string;
  isLoading: boolean;
};

export function ThinkingPanel({ text, isLoading }: ThinkingPanelProps) {
  if (!isLoading || !text?.trim()) {
    return null;
  }

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text color={theme.thinking} bold>
        Thinking
      </Text>
      <Box paddingLeft={2}>
        <Text>{text}</Text>
      </Box>
    </Box>
  );
}
