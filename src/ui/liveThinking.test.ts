import { expect, test } from "bun:test";
import { formatLiveThinkingDisplayText } from "./liveThinking.ts";

test("formatLiveThinkingDisplayText returns undefined for empty text", () => {
  expect(formatLiveThinkingDisplayText("")).toBeUndefined();
  expect(formatLiveThinkingDisplayText("   ")).toBeUndefined();
});

test("formatLiveThinkingDisplayText keeps short text unchanged", () => {
  expect(formatLiveThinkingDisplayText("short text")).toBe("short text");
});

test("formatLiveThinkingDisplayText truncates long multi-line text from the front", () => {
  const input = Array.from({ length: 20 }, (_, index) => `line-${index + 1}`).join("\n");
  const output = formatLiveThinkingDisplayText(input);

  expect(output?.startsWith("...（已折叠更早的流式输出）")).toBe(true);
  expect(output).toContain("line-20");
  expect(output).not.toContain("line-1\n");
});
