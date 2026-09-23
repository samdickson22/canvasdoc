import assert from "node:assert/strict";
import test from "node:test";
import { concatenateBytes, encodeBase64 } from "../src/bytes.ts";

test("browser base64 matches binary encoding across upload and transfer chunk boundaries", () => {
  for (const size of [0, 1, 32767, 32768, 32769, 384 * 1024, 5 * 1024 * 1024]) {
    const bytes = Uint8Array.from({ length: size }, (_, index) => index % 256);
    assert.equal(encodeBase64(bytes), Buffer.from(bytes).toString("base64"));
  }
});

test("material chunks preserve bytes and ordering, including empty chunks and views", () => {
  const source = Uint8Array.from([0, 255, 128, 65, 0, 17]);
  const chunks = [
    source.subarray(0, 2),
    new Uint8Array(),
    source.subarray(2, 5),
    source.subarray(5),
  ];
  assert.deepEqual(concatenateBytes(chunks, source.length), source);
  assert.deepEqual(concatenateBytes([], 0), new Uint8Array());
});
