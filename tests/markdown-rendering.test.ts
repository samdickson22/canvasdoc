import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";

test("Markdown renders coursework math safely and resolves file-preview links", async () => {
  const directory = await mkdtemp(path.resolve("node_modules/.markdown-test-"));
  try {
    const outfile = path.join(directory, "render.mjs");
    await build({
      stdin: {
        contents:
          'export * from "./src/markdown-rendering"; export {highlight as highlightMarkdownCode} from "./src/highlighter-entry";',
        resolveDir: process.cwd(),
      },
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      jsx: "automatic",
      external: [
        "react",
        "react-dom",
        "@assistant-ui/react",
        "@assistant-ui/react-markdown",
        "remark-gfm",
        "remark-math",
        "rehype-katex",
        "shiki/*",
      ],
      loader: { ".css": "text" },
      plugins: [
        {
          name: "synthetic-companion",
          setup(b) {
            b.onResolve({ filter: /runtime\/client$/ }, () => ({
              path: "client",
              namespace: "synthetic",
            }));
            b.onLoad({ filter: /.*/, namespace: "synthetic" }, () => ({
              contents:
                'export const useConnection = () => ({root:"/workspace",status:"connected"}); export const workspaceRequest = () => { throw new Error("Unexpected file read"); };',
              loader: "js",
            }));
          },
        },
      ],
    });
    const m = await import(pathToFileURL(outfile).href);
    const render = (text: string) =>
      renderToStaticMarkup(
        React.createElement(
          m.MarkdownDocument.Provider,
          { value: { path: "reports/main.md", open: () => {} } },
          React.createElement(
            ReactMarkdown,
            {
              remarkPlugins: m.markdownPlugins,
              rehypePlugins: m.markdownRehypePlugins,
              components: { a: m.MarkdownLink, img: m.MarkdownImage },
            },
            m.preprocessMarkdown(text),
          ),
        ),
      );
    assert.match(render("\\(x^2\\)"), /class="katex"/);
    assert.match(render("Price: $5 and $10."), /Price: \$5 and \$10/);
    assert.doesNotMatch(render("`\\(x\\)`"), /class="katex"/);
    assert.match(render("[Notes](notes.md)"), /href="reports\/notes.md"/);
    assert.match(
      render("[Canvas](/courses/1/assignments/2)"),
      /href="\/courses\/1\/assignments\/2"/,
    );
    assert.match(
      render("[Web](https://example.com)"),
      /href="https:\/\/example.com"/,
    );
    assert.doesNotMatch(render("[Escape](../../secret.md)"), /<a /);
    assert.doesNotMatch(
      render("![Plot](plots/result.png)"),
      /src="plots\/result.png"/,
    );
    assert.match(render("![Plot](plots/result.png)"), /Loading image/);
    assert.doesNotMatch(
      render("[Bad](javascript:alert%281%29)"),
      /href="javascript:/,
    );
    assert.match(render("<script>alert(1)</script>"), /&lt;script&gt;/);
    const tokens = await m.highlightMarkdownCode("const x = 1;", "javascript");
    assert.equal(
      tokens
        .flat()
        .map((token: any) => token.content)
        .join(""),
      "const x = 1;",
    );
    assert.ok(tokens.flat().some((token: any) => token.color));
    assert.equal(
      await m.highlightMarkdownCode("literal source", "unsupported-language"),
      null,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
