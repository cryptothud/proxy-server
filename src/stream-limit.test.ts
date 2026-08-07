import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { streamWithLimit, type ByteSink } from "./stream-limit";

/** Records what reached the client and whether the connection was cut. */
const makeSink = () => {
  const written: number[] = [];
  let destroyed = false;
  let ended = false;

  const sink: ByteSink = {
    write(chunk) {
      written.push(chunk.byteLength);
      return true;
    },
    end() {
      ended = true;
    },
    destroy() {
      destroyed = true;
    },
    once() {
      return sink;
    },
  };

  return {
    sink,
    get bytesWritten() {
      return written.reduce((a, b) => a + b, 0);
    },
    get destroyed() {
      return destroyed;
    },
    get ended() {
      return ended;
    },
  };
};

/** Emits `count` chunks of `size` bytes, tracking how many were actually pulled. */
const makeBody = (count: number, size: number) => {
  let produced = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (produced >= count) {
        controller.close();
        return;
      }
      produced++;
      controller.enqueue(new Uint8Array(size));
    },
  });
  return {
    stream,
    get chunksProduced() {
      return produced;
    },
  };
};

describe("streamWithLimit", () => {
  it("passes through a body under the limit", async () => {
    const sink = makeSink();
    const body = makeBody(4, 1000);

    const result = await streamWithLimit(body.stream, sink.sink, 10_000);

    assert.deepEqual(result, { ok: true, bytes: 4000 });
    assert.equal(sink.bytesWritten, 4000);
    assert.equal(sink.ended, true);
    assert.equal(sink.destroyed, false);
  });

  it("aborts once the running total exceeds the limit", async () => {
    const sink = makeSink();
    const body = makeBody(100, 1000); // 100 KB available

    const result = await streamWithLimit(body.stream, sink.sink, 10_000);

    assert.equal(result.ok, false);
    assert.equal(sink.destroyed, true);
    assert.equal(sink.ended, false);
  });

  /**
   * The point of streaming: the transfer must stop near the cap rather than after the whole
   * body has been pulled into memory. A buffer-then-measure implementation passes the test
   * above but fails this one.
   */
  it("stops reading instead of draining the whole upstream", async () => {
    const sink = makeSink();
    const body = makeBody(50_000, 1024); // ~50 MB available

    const result = await streamWithLimit(body.stream, sink.sink, 64 * 1024); // 64 KB cap

    assert.equal(result.ok, false);
    // Should have pulled ~65 chunks, not 50,000.
    assert.ok(
      body.chunksProduced < 100,
      `pulled ${body.chunksProduced} chunks; expected to stop near the cap`,
    );
    assert.ok(result.bytes <= 64 * 1024 + 1024, `read ${result.bytes} bytes past the cap`);
  });

  it("invokes the exceeded callback exactly once", async () => {
    const sink = makeSink();
    const body = makeBody(1000, 1024);
    let calls = 0;

    await streamWithLimit(body.stream, sink.sink, 4096, () => calls++);

    assert.equal(calls, 1);
  });

  it("handles a null body", async () => {
    const sink = makeSink();
    const result = await streamWithLimit(null, sink.sink, 1000);
    assert.deepEqual(result, { ok: true, bytes: 0 });
    assert.equal(sink.ended, true);
  });
});
