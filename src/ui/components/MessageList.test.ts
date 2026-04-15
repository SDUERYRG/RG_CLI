import { expect, test } from "bun:test";
import { createMessage } from "../../session/messages.ts";
import { reconcileStaticMessages } from "./MessageList.tsx";

test("reconcileStaticMessages appends only newly added messages", () => {
  const first = createMessage("assistant", "first");
  const second = createMessage("assistant", "second");
  const third = createMessage("assistant", "third");
  const fourth = createMessage("assistant", "fourth");

  expect(
    reconcileStaticMessages([first], [first, second, third, fourth], 2),
  ).toEqual({
    mode: "append",
    staticMessages: [second],
  });
});

test("reconcileStaticMessages resets when message history is replaced", () => {
  const first = createMessage("assistant", "first");
  const second = createMessage("assistant", "second");
  const replacement = createMessage("assistant", "replacement");

  expect(
    reconcileStaticMessages([first, second], [replacement], 0),
  ).toEqual({
    mode: "reset",
    staticMessages: [replacement],
  });
});

test("reconcileStaticMessages ignores changes inside the dynamic tail", () => {
  const first = createMessage("assistant", "first", {
    kind: "tool_call",
    toolCallId: "call_1",
  });
  const updatedFirst = {
    ...first,
    content: "first\n\nresult",
  };

  expect(
    reconcileStaticMessages([], [updatedFirst], 2),
  ).toEqual({
    mode: "noop",
    staticMessages: [],
  });
});

test("reconcileStaticMessages resets when an existing static message content changes", () => {
  const first = createMessage("assistant", "first", {
    kind: "tool_call",
    toolCallId: "call_1",
  });
  const second = createMessage("assistant", "second");
  const updatedFirst = {
    ...first,
    content: "first\n\nresult",
  };

  expect(
    reconcileStaticMessages([first], [updatedFirst, second], 1),
  ).toEqual({
    mode: "reset",
    staticMessages: [updatedFirst],
  });
});
