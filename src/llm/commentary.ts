export const COMMENTARY_OPEN_TAG = "<commentary>";
export const COMMENTARY_CLOSE_TAG = "</commentary>";

type CommentaryExtractionResult = {
  commentaryTexts: string[];
  outputText: string;
};

type CommentaryStreamToken =
  | {
    type: "commentary";
    text: string;
  }
  | {
    type: "output";
    text: string;
  };

function normalizeCommentaryText(text: string): string | undefined {
  const normalized = text.trim();
  return normalized ? normalized : undefined;
}

function getLongestSuffixPrefixLength(text: string, pattern: string): number {
  const maxLength = Math.min(text.length, pattern.length - 1);

  for (let length = maxLength; length > 0; length -= 1) {
    if (pattern.startsWith(text.slice(-length))) {
      return length;
    }
  }

  return 0;
}

export function extractCommentaryFromText(text: string): CommentaryExtractionResult {
  const commentaryTexts: string[] = [];
  let outputText = "";
  let cursor = 0;

  while (cursor < text.length) {
    const startIndex = text.indexOf(COMMENTARY_OPEN_TAG, cursor);

    if (startIndex === -1) {
      outputText += text.slice(cursor);
      break;
    }

    outputText += text.slice(cursor, startIndex);
    const commentaryStartIndex = startIndex + COMMENTARY_OPEN_TAG.length;
    const endIndex = text.indexOf(COMMENTARY_CLOSE_TAG, commentaryStartIndex);

    if (endIndex === -1) {
      outputText += text.slice(startIndex);
      break;
    }

    const commentaryText = normalizeCommentaryText(
      text.slice(commentaryStartIndex, endIndex),
    );
    if (commentaryText) {
      commentaryTexts.push(commentaryText);
    }

    cursor = endIndex + COMMENTARY_CLOSE_TAG.length;
  }

  return {
    commentaryTexts,
    outputText,
  };
}

export class CommentaryTextStreamParser {
  private mode: "output" | "commentary" = "output";
  private buffer = "";
  private currentCommentaryText = "";

  push(text: string): CommentaryStreamToken[] {
    if (!text) {
      return [];
    }

    this.buffer += text;
    const tokens: CommentaryStreamToken[] = [];

    while (this.buffer.length > 0) {
      if (this.mode === "output") {
        const startIndex = this.buffer.indexOf(COMMENTARY_OPEN_TAG);

        if (startIndex !== -1) {
          const outputText = this.buffer.slice(0, startIndex);
          if (outputText) {
            tokens.push({
              type: "output",
              text: outputText,
            });
          }

          this.buffer = this.buffer.slice(
            startIndex + COMMENTARY_OPEN_TAG.length,
          );
          this.mode = "commentary";
          this.currentCommentaryText = "";
          continue;
        }

        const partialTagLength = getLongestSuffixPrefixLength(
          this.buffer,
          COMMENTARY_OPEN_TAG,
        );
        const outputText = this.buffer.slice(0, this.buffer.length - partialTagLength);
        if (outputText) {
          tokens.push({
            type: "output",
            text: outputText,
          });
        }

        this.buffer = this.buffer.slice(this.buffer.length - partialTagLength);
        break;
      }

      const endIndex = this.buffer.indexOf(COMMENTARY_CLOSE_TAG);

      if (endIndex !== -1) {
        this.currentCommentaryText += this.buffer.slice(0, endIndex);
        const commentaryText = normalizeCommentaryText(this.currentCommentaryText);
        if (commentaryText) {
          tokens.push({
            type: "commentary",
            text: commentaryText,
          });
        }

        this.buffer = this.buffer.slice(endIndex + COMMENTARY_CLOSE_TAG.length);
        this.mode = "output";
        this.currentCommentaryText = "";
        continue;
      }

      const partialTagLength = getLongestSuffixPrefixLength(
        this.buffer,
        COMMENTARY_CLOSE_TAG,
      );
      this.currentCommentaryText += this.buffer.slice(
        0,
        this.buffer.length - partialTagLength,
      );
      this.buffer = this.buffer.slice(this.buffer.length - partialTagLength);
      break;
    }

    return tokens;
  }

  flush(): CommentaryStreamToken[] {
    if (!this.buffer && !this.currentCommentaryText) {
      return [];
    }

    if (this.mode === "output") {
      const outputText = this.buffer;
      this.buffer = "";
      return outputText
        ? [{
          type: "output" as const,
          text: outputText,
        }]
        : [];
    }

    const outputText = `${COMMENTARY_OPEN_TAG}${this.currentCommentaryText}${this.buffer}`;
    this.mode = "output";
    this.buffer = "";
    this.currentCommentaryText = "";
    return outputText
      ? [{
        type: "output" as const,
        text: outputText,
      }]
      : [];
  }
}
