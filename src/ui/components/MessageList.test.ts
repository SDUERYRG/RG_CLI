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
