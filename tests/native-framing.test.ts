import test from "node:test";
import assert from "node:assert/strict";
import { nativeFrames, nativeReceiver } from "../companion/native-framing.ts";

test("native frames recover oversized run and connection snapshots without loss", () => {
  for (const value of [
    { type: "run", run: { text: "😀\u0000\"\\".repeat(160000) } },
    { type: "connected", runs: Array.from({ length: 64 }, (_, id) => ({ id, text: "x".repeat(95000) })) },
    { type: "files-result", result: { base64: "a".repeat(2000000) } },
  ]) {
    const receive = nativeReceiver();
    const frames = [...nativeFrames(value)];
    assert.ok(frames.length > 1);
    for (const [index, frame] of frames.entries()) {
      assert.ok(Buffer.byteLength(frame) <= 900000);
      const response = receive(JSON.parse(frame));
      if (index < frames.length - 1) assert.equal(response, undefined);
      else assert.deepEqual(response?.value, value);
    }
    assert.deepEqual(receive({ type: "receipt" }), { value: { type: "receipt" } });
  }
});

test("native receiver rejects missing, interleaved, and out-of-order chunks", () => {
  const chunks = [...nativeFrames({ text: "x".repeat(1000000) })].map(frame => JSON.parse(frame));
  assert.throws(() => nativeReceiver()(chunks[1]), /out of order/);
  const receive = nativeReceiver();
  receive(chunks[0]);
  assert.throws(() => receive({ type: "run" }), /before all chunks/);
  assert.throws(() => receive({ ...chunks[1], id: "other" }), /out of order/);
});
