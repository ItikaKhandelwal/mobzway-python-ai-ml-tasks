/**
 * Converts a standard Server-Sent Events response body into individual data payloads.
 * Supports chunk boundaries and multi-line data events.
 */
export async function* parseSSE(readableStream) {
  if (!readableStream) {
    throw new Error("The AI provider returned an empty stream.");
  }

  const reader = readableStream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      buffer = buffer.replaceAll("\r\n", "\n");

      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const rawEvent = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);

        const data = rawEvent
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");

        if (data) yield data;
        boundary = buffer.indexOf("\n\n");
      }

      if (done) break;
    }

    const finalData = buffer
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");

    if (finalData) yield finalData;
  } finally {
    reader.releaseLock();
  }
}
