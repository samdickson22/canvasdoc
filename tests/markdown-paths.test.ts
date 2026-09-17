import test from "node:test";
import assert from "node:assert/strict";
import { markdownWorkspacePath } from "../src/markdown-paths.ts";

test("Markdown local references resolve against the current document, not Canvas", () => {
  assert.equal(
    markdownWorkspacePath("notes.md", "/workspace", "reports/main.md"),
    "reports/notes.md",
  );
  assert.equal(
    markdownWorkspacePath(
      "../plots/result.png",
      "/workspace",
      "reports/main.md",
    ),
    "plots/result.png",
  );
  assert.equal(
    markdownWorkspacePath("plots/result.png", "/workspace"),
    "plots/result.png",
  );
  assert.equal(
    markdownWorkspacePath(
      "/workspace/report.md#L2",
      "/workspace",
      "reports/main.md",
    ),
    "report.md",
  );
  assert.equal(
    markdownWorkspacePath("chapter%231.md", "/workspace", "reports/main.md"),
    "reports/chapter#1.md",
  );
  assert.equal(
    markdownWorkspacePath("my%20notes.md", "/workspace"),
    "my notes.md",
  );
});

test("Markdown references preserve Canvas and web navigation and reject private or escaped files", () => {
  for (const href of [
    "https://example.com/a",
    "/courses/1/assignments/2",
    "/files/12",
    "#section",
    "//example.com",
    "javascript:alert(1)",
    "file:///etc/passwd",
    "../../outside.md",
    "%2e%2e/%2e%2e/outside.md",
    ".private/secret",
    "../.state/secret",
    "%2Fetc/passwd",
    "bad%00name.png",
    "bad%ZZ",
    "a\\b.png",
  ]) {
    assert.equal(
      markdownWorkspacePath(href, "/workspace", "reports/main.md"),
      null,
      href,
    );
  }
});
