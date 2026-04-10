export type ParsedSseEvent = {
  event?: string;
  data: string;
  id?: string;
  retry?: number;
};

function parseEventBlock(block: string): ParsedSseEvent | null {
  const normalizedBlock = block.replace(/\r/g, "");
  const lines = normalizedBlock.split("\n");
  let event: string | undefined;
  let id: string | undefined;
  let retry: number | undefined;
  const dataLines: string[] = [];

  for (const line of lines) {
    if (!line || line.startsWith(":")) {
      continue;
    }

    const separatorIndex = line.indexOf(":");
    const field = separatorIndex === -1 ? line : line.slice(0, separatorIndex);
    let value = separatorIndex === -1 ? "" : line.slice(separatorIndex + 1);
    if (value.startsWith(" ")) {
      value = value.slice(1);
    }

    if (field === "event") {
      event = value;
      continue;
    }

    if (field === "data") {
      dataLines.push(value);
      continue;
    }

    if (field === "id") {
      id = value;
      continue;
    }

    if (field === "retry") {
      const parsedRetry = Number.parseInt(value, 10);
      if (!Number.isNaN(parsedRetry)) {
        retry = parsedRetry;
      }
    }
  }

  if (dataLines.length === 0 && event === undefined && id === undefined && retry === undefined) {
    return null;
  }

  return {
    event,
    data: dataLines.join("\n"),
    id,
    retry,
  };
}

export async function* parseSse(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<ParsedSseEvent, void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, "\n");

      let separatorIndex = buffer.indexOf("\n\n");
      while (separatorIndex !== -1) {
        const block = buffer.slice(0, separatorIndex);
        buffer = buffer.slice(separatorIndex + 2);
        const parsedEvent = parseEventBlock(block);
        if (parsedEvent) {
          yield parsedEvent;
        }
        separatorIndex = buffer.indexOf("\n\n");
      }
    }

    buffer += decoder.decode();
    const trailingEvent = parseEventBlock(buffer.trim());
    if (trailingEvent) {
      yield trailingEvent;
    }
  } finally {
    reader.releaseLock();
  }
}
