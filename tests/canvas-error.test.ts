import assert from "node:assert/strict";
import test from "node:test";
import { canvasResponseError } from "../src/canvas-error.ts";
test("only explicit Canvas disabled-section responses are classified unavailable", async () => {
  const disabled = await canvasResponseError(
    Response.json(
      { message: "That page has been disabled for this course" },
      { status: 404 },
    ),
  );
  assert.equal(disabled.unavailable, true);
  for (const status of [403, 404, 500]) {
    const error = await canvasResponseError(
      Response.json({ errors: [{ message: "Not found" }] }, { status }),
    );
    assert.equal(error.unavailable, false);
    assert.equal(error.status, status);
  }
  assert.match(
    (await canvasResponseError(new Response("", { status: 401 }))).message,
    /Sign in/,
  );
});
