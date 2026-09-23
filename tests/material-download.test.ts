import assert from "node:assert/strict";
import test from "node:test";
import { materialDownload } from "../extension/material-download.ts";
test("extension revalidates linked file identity without assuming course membership", async (t) => {
  const urls: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: any) => {
    urls.push(String(url));
    return String(url).includes("/api/v1/files/")
      ? Response.json({
          url: "https://canvas.invalid/files/42/download",
          filename: "data.txt",
        })
      : new Response("content");
  });
  for (const sourceUrl of [
    "https://canvas.invalid/courses/99/files/42?wrap=1",
    "https://canvas.invalid/files/42",
    "https://canvas.invalid/files/42/download",
  ]) {
    const { id } = await materialDownload(
      { op: "begin", sourceUrl },
      "https://canvas.invalid/courses/1",
    );
    assert.equal(urls.at(-2), "https://canvas.invalid/api/v1/files/42");
    await materialDownload({ op: "cancel", id }, "https://canvas.invalid/");
  }
  const count = urls.length;
  await assert.rejects(
    materialDownload(
      { op: "begin", sourceUrl: "https://evil.invalid/files/42" },
      "https://canvas.invalid/",
    ),
  );
  assert.equal(urls.length, count);
});
