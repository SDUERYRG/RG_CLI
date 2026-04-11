const MAX_VISIBLE_THINKING_LINES = 14;
const MAX_VISIBLE_THINKING_CHARACTERS = 1200;
const TRUNCATED_THINKING_PREFIX = "...（已折叠更早的流式输出）\n";

export const LIVE_THINKING_UPDATE_INTERVAL_MS = 40;

export function formatLiveThinkingDisplayText(
  text: string | undefined,
): string | undefined {
  if (!text?.trim()) {
    return undefined;
  }

  const normalized = text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
  const lines = normalized.split("\n");
  let visibleText = normalized;
  let wasTruncated = false;

  if (lines.length > MAX_VISIBLE_THINKING_LINES) {
    visibleText = lines.slice(-MAX_VISIBLE_THINKING_LINES).join("\n");
    wasTruncated = true;
  }

  if (visibleText.length > MAX_VISIBLE_THINKING_CHARACTERS) {
    visibleText = visibleText.slice(-MAX_VISIBLE_THINKING_CHARACTERS).trimStart();
    wasTruncated = true;
  }

  return wasTruncated
    ? `${TRUNCATED_THINKING_PREFIX}${visibleText}`
    : visibleText;
}
