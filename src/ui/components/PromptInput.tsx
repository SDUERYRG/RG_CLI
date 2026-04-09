/**
 * 文件信息
 * 时间：2026-04-03 23:50:53 +08:00
 * 作用：封装底部输入框区域，负责接收用户文本输入。
 * 说明：输入行为和页面状态解耦，后续可平滑替换成更复杂的输入组件。
 */
import React from "react";
import { Box, Text } from "ink";
import TextInput from "ink-text-input";
import { theme } from "../theme.ts";

type PromptInputProps = {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  isBusy?: boolean;
};

export function PromptInput({
  value,
  onChange,
  onSubmit,
  isBusy = false,
}: PromptInputProps) {
  return (
    <Box
      marginTop={1}
      borderStyle="round"
      borderColor={theme.primary}
      paddingX={1}
    >
      <Box marginRight={1}>
        <Text color={theme.accent} bold>
          &gt;
        </Text>
      </Box>
      <TextInput
        value={value}
        onChange={onChange}
        onSubmit={onSubmit}
        placeholder={isBusy ? "模型处理中，请稍候..." : "输入消息并按 Enter 发送..."}
      />
    </Box>
  );
}
