export type PromptInputState = {
  value: string;
  cursorOffset: number;
};

export type PromptInputKey = {
  upArrow?: boolean;
  downArrow?: boolean;
  leftArrow?: boolean;
  rightArrow?: boolean;
  return?: boolean;
  escape?: boolean;
  ctrl?: boolean;
  shift?: boolean;
  tab?: boolean;
  backspace?: boolean;
  delete?: boolean;
  meta?: boolean;
};

export type PromptInputAction =
  | { type: "noop" }
  | { type: "exit" }
  | { type: "submit"; value: string; nextState: PromptInputState }
  | { type: "update"; nextState: PromptInputState };

function clampCursorOffset(value: string, cursorOffset: number): number {
  return Math.max(0, Math.min(cursorOffset, value.length));
}

export function createPromptInputState(value = ""): PromptInputState {
  return {
    value,
    cursorOffset: value.length,
  };
}

export function applyPromptInputKey(
  state: PromptInputState,
  input: string,
  key: PromptInputKey,
): PromptInputAction {
  if (
    key.upArrow ||
    key.downArrow ||
    key.tab ||
    key.escape ||
    (key.ctrl && input === "c")
  ) {
    return { type: "noop" };
  }

  if (!state.value && input.length === 1 && input.toLowerCase() === "q" && !key.ctrl && !key.meta) {
    return { type: "exit" };
  }

  if (key.return) {
    if (!state.value.trim()) {
      return {
        type: "update",
        nextState: createPromptInputState(""),
      };
    }

    return {
      type: "submit",
      value: state.value,
      nextState: createPromptInputState(""),
    };
  }

  if (key.leftArrow) {
    return {
      type: "update",
      nextState: {
        ...state,
        cursorOffset: clampCursorOffset(state.value, state.cursorOffset - 1),
      },
    };
  }

  if (key.rightArrow) {
    return {
      type: "update",
      nextState: {
        ...state,
        cursorOffset: clampCursorOffset(state.value, state.cursorOffset + 1),
      },
    };
  }

  if (key.backspace || key.delete) {
    if (state.cursorOffset === 0) {
      return { type: "noop" };
    }

    const nextValue = state.value.slice(0, state.cursorOffset - 1) +
      state.value.slice(state.cursorOffset);

    return {
      type: "update",
      nextState: {
        value: nextValue,
        cursorOffset: clampCursorOffset(nextValue, state.cursorOffset - 1),
      },
    };
  }

  if (!input || key.ctrl || key.meta) {
    return { type: "noop" };
  }

  const safeCursorOffset = clampCursorOffset(state.value, state.cursorOffset);
  const nextValue = state.value.slice(0, safeCursorOffset) +
    input +
    state.value.slice(safeCursorOffset);

  return {
    type: "update",
    nextState: {
      value: nextValue,
      cursorOffset: safeCursorOffset + input.length,
    },
  };
}
