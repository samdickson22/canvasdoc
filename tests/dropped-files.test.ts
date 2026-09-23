import assert from "node:assert/strict";
import test from "node:test";
import { hasFileDrop, readDroppedFiles } from "../src/runtime/dropped-files.ts";

const screenshot = new File(["image"], "Screenshot.png", {
  type: "image/png",
  lastModified: 1,
});
const transfer = (files: File[], items: unknown[], types = ["Files"]) =>
  ({ files, items, types }) as unknown as DataTransfer;

test("screenshot items attach when the drop FileList is empty", async () => {
  const data = transfer(
    [],
    [{ kind: "file", getAsFile: () => screenshot }],
    [],
  );
  assert.equal(hasFileDrop(data), true);
  assert.deepEqual(await readDroppedFiles(data), [screenshot]);
});
test("capture a deferred file entry before the drop data is protected", async () => {
  let captured = false;
  const data = transfer(
    [],
    [
      {
        kind: "file",
        getAsFile: () => null,
        webkitGetAsEntry: () => {
          captured = true;
          return {
            isFile: true,
            file: (resolve: (file: File) => void) =>
              setTimeout(() => resolve(screenshot), 0),
          };
        },
      },
    ],
  );
  const result = readDroppedFiles(data);
  assert.equal(captured, true);
  assert.deepEqual(await result, [screenshot]);
});
test("the same file exposed through files and items attaches only once", async () => {
  assert.deepEqual(
    await readDroppedFiles(
      transfer([screenshot], [{ kind: "file", getAsFile: () => screenshot }]),
    ),
    [screenshot],
  );
});
test("unreadable drops return no files so the composer can show an error", async () => {
  assert.deepEqual(
    await readDroppedFiles(
      transfer([], [{ kind: "file", getAsFile: () => null }]),
    ),
    [],
  );
});
