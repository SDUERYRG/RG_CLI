import { expect, test } from "bun:test";
import {
  applyPromptInputKey,
  createPromptInputState,
} from "./promptInputState.ts";

test("prompt input keeps all characters across rapid sequential typing", () => {
  let state = createPromptInputState();

  for (const char of ["r", "e", "a", "d"]) {
    const action = applyPromptInputKey(state, char, {});
    expect(action.type).toBe("update");
    if (action.type === "update") {
      state = action.nextState;
    }
  }

  expect(state.value).toBe("read");
  expect(state.cursorOffset).toBe(4);
});

test("prompt input inserts text at the current cursor position", () => {
  let state = createPromptInputState("rad");

  for (let index = 0; index < 2; index += 1) {
    const moveLeft = applyPromptInputKey(state, "", { leftArrow: true });
    expect(moveLeft.type).toBe("update");
    if (moveLeft.type === "update") {
      state = moveLeft.nextState;
    }
  }

  const insert = applyPromptInputKey(state, "e", {});
  expect(insert.type).toBe("update");
  if (insert.type === "update") {
    state = insert.nextState;
  }

  expect(state.value).toBe("read");
  expect(state.cursorOffset).toBe(2);
});

test("prompt input exits on q when the input is empty", () => {
  const action = applyPromptInputKey(createPromptInputState(), "q", {});
  expect(action).toEqual({ type: "exit" });
});

test("prompt input submits and clears the current value", () => {
  const action = applyPromptInputKey(
    createPromptInputState("read"),
    "",
    { return: true },
  );

  expect(action.type).toBe("submit");
  if (action.type === "submit") {
    expect(action.value).toBe("read");
    expect(action.nextState).toEqual(createPromptInputState(""));
  }
});

test("prompt input treats delete as backward delete for terminal compatibility", () => {
  const action = applyPromptInputKey(
    createPromptInputState("read"),
    "",
    { delete: true },
  );

  expect(action.type).toBe("update");
  if (action.type === "update") {
    expect(action.nextState.value).toBe("rea");
    expect(action.nextState.cursorOffset).toBe(3);
  }
});
