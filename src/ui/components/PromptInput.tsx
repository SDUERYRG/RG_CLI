/**
 * 文件信息
 * 时间：2026-04-03 23:50:53 +08:00
 * 作用：封装底部输入框区域，负责接收用户文本输入。
 * 说明：使用本地输入状态，避免长消息列表下快速输入时出现字符丢失。
 */
import React, { useRef, useState } from "react";
import { Box, Text, useInput } from "ink";
import { theme } from "../theme.ts";
import {
  applyPromptInputKey,
  createPromptInputState,
  type PromptInputState,
} from "./promptInputState.ts";

type PromptInputProps = {
  onSubmit: (value: string) => void;
  onExitRequest?: () => void;
  isBusy?: boolean;
};

function renderInputLine(
  state: PromptInputState,
  placeholder: string,
): React.ReactNode {
  const { value, cursorOffset } = state;

  if (value.length === 0) {
    return (
      <>
        <Text color={theme.accent} bold>|</Text>
        <Text dimColor>{placeholder}</Text>
      </>
    );
  }

  const beforeCursor = value.slice(0, cursorOffset);
  const cursorCharacter = cursorOffset < value.length ? value[cursorOffset] : " ";
  const afterCursor = cursorOffset < value.length ? value.slice(cursorOffset + 1) : "";

  return (
    <>
      {beforeCursor ? <Text>{beforeCursor}</Text> : null}
      <Text color={theme.accent} bold>{cursorCharacter}</Text>
      {afterCursor ? <Text>{afterCursor}</Text> : null}
    </>
  );
}

export function PromptInput({
  onSubmit,
  onExitRequest,
  isBusy = false,
}: PromptInputProps) {
  const [renderState, setRenderState] = useState(() => createPromptInputState(""));
  const stateRef = useRef(renderState);
  const submitRef = useRef(onSubmit);
  const exitRequestRef = useRef(onExitRequest);

  stateRef.current = renderState;
  submitRef.current = onSubmit;
  exitRequestRef.current = onExitRequest;

  useInput((input, key) => {
    const action = applyPromptInputKey(stateRef.current, input, key);

    if (action.type === "noop") {
      return;
    }

    if (action.type === "exit") {
      exitRequestRef.current?.();
      return;
    }

    stateRef.current = action.nextState;
    setRenderState(action.nextState);

    if (action.type === "submit") {
      submitRef.current(action.value);
    }
  });

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
      <Box flexGrow={1}>
        {renderInputLine(
          renderState,
          isBusy ? "模型处理中，请稍候..." : "输入消息并按 Enter 发送...",
        )}
      </Box>
    </Box>
  );
}
