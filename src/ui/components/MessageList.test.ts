import { expect, test } from "bun:test";
import { createMessage } from "../../session/messages.ts";
import { reconcileStaticMessages } from "./MessageList.tsx";

test("reconcileStaticMessages appends only newly added messages", () => {
  const first = createMessage("assistant", "first");
  const second = createMessage("assistant", "second");
  const third = createMessage("assistant", "third");

  expect(
    reconcileStaticMessages([first], [first, second, third]),
  ).toEqual({
    mode: "append",
    messages: [second, third],
  });
});

test("reconcileStaticMessages resets when message history is replaced", () => {
  const first = createMessage("assistant", "first");
  const second = createMessage("assistant", "second");
  const replacement = createMessage("assistant", "replacement");

  expect(
    reconcileStaticMessages([first, second], [replacement]),
  ).toEqual({
    mode: "reset",
    messages: [replacement],
  });
});

test("reconcileStaticMessages resets when an existing message content changes", () => {
  const first = createMessage("assistant", "first", {
    kind: "tool_call",
    toolCallId: "call_1",
  });
  const updatedFirst = {
    ...first,
    content: "first\n\nresult",
  };

  expect(
    reconcileStaticMessages([first], [updatedFirst]),
  ).toEqual({
    mode: "reset",
    messages: [updatedFirst],
  });
});
