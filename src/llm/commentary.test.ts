import { expect, test } from "bun:test";
import {
  CommentaryTextStreamParser,
  extractCommentaryFromText,
} from "./commentary.ts";

test("extractCommentaryFromText separates commentary tags from final output", () => {
  expect(
    extractCommentaryFromText(
      "<commentary>先看结构</commentary>结论：这是一个 CLI",
    ),
  ).toEqual({
    commentaryTexts: ["先看结构"],
    outputText: "结论：这是一个 CLI",
  });
});

test("CommentaryTextStreamParser preserves output order while extracting commentary", () => {
  const parser = new CommentaryTextStreamParser();

  expect(
    parser.push("<commentary>我先"),
  ).toEqual([]);

  expect(
    parser.push("看一下</commentary>然后回答"),
  ).toEqual([
    {
      type: "commentary",
      text: "我先看一下",
    },
    {
      type: "output",
      text: "然后回答",
    },
  ]);
});
