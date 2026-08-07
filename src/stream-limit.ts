import { once } from "node:events";

/** Minimal surface of the response sink, so this is testable without a live server. */
export type ByteSink = {
  write(chunk: Buffer): boolean;
  end(): void;
  destroy(): void;
  once(event: string, listener: () => void): unknown;
};

export type StreamResult = { ok: true; bytes: number } | { ok: false; bytes: number };

/**
 * Copies a body to `sink`, stopping the moment it exceeds `maxBytes`.
 *
 * The limit is enforced against a running total rather than `content-length`, because a
 * chunked response omits that header entirely — and buffering the body first in order to
 * measure it would allocate exactly the payload the limit exists to prevent.
 */
export const streamWithLimit = async (
  body: ReadableStream<Uint8Array> | null,
  sink: ByteSink,
  maxBytes: number,
  onExceeded?: () => void
): Promise<StreamResult> => {
  if (!body) {
    sink.end();
    return { ok: true, bytes: 0 };
  }

  const reader = body.getReader();
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      total += value.byteLength;
      if (total > maxBytes) {
        onExceeded?.();
        sink.destroy();
        return { ok: false, bytes: total };
      }

      // Respect backpressure. Without this a slow client lets the upstream accumulate
      // unbounded inside the response stream — the same exhaustion by another route.
      if (!sink.write(Buffer.from(value))) {
        await once(sink as never, "drain");
      }
    }

    sink.end();
    return { ok: true, bytes: total };
  } finally {
    reader.releaseLock();
  }
};
