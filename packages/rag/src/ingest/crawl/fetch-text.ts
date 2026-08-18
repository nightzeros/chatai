const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_BYTES = 2 * 1024 * 1024;

export async function fetchText(
  url: string,
  init: {
    fetcher: typeof fetch;
    userAgent: string;
    timeoutMs?: number;
    maxBytes?: number;
  },
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), init.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    const response = await init.fetcher(url, {
      signal: controller.signal,
      headers: { "User-Agent": init.userAgent, Accept: "text/html,application/xhtml+xml,text/plain,*/*" },
      redirect: "follow",
    });
    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}.`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      const text = await response.text();
      if (text.length > (init.maxBytes ?? MAX_BYTES)) {
        throw new Error("Response exceeded the 2 MB limit.");
      }
      return text;
    }

    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > (init.maxBytes ?? MAX_BYTES)) {
        throw new Error("Response exceeded the 2 MB limit.");
      }
      chunks.push(value);
    }

    return new TextDecoder().decode(
      chunks.reduce((buffer, chunk) => {
        const merged = new Uint8Array(buffer.length + chunk.length);
        merged.set(buffer);
        merged.set(chunk, buffer.length);
        return merged;
      }, new Uint8Array()),
    );
  } finally {
    clearTimeout(timeout);
  }
}
