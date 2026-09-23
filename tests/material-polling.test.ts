import { build } from "esbuild";
import { DOMParser } from "linkedom";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
test("material response cache avoids repeated scans and retries denied endpoints only on force", async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), "canvasdoc-polling-"));
  const calls: string[] = [];
  (globalThis as any).__materialCalls = calls;
  (globalThis as any).location = { origin: "https://canvas.invalid" };
  (globalThis as any).DOMParser = class extends DOMParser {
    parseFromString(text: string, type: any) {
      return super.parseFromString(
        `<html><head></head><body>${text}</body></html>`,
        type,
      );
    }
  };
  try {
    const out = path.join(folder, "collector.mjs");
    await build({
      entryPoints: ["src/material-collector.ts"],
      outfile: out,
      bundle: true,
      platform: "node",
      format: "esm",
      banner: {
        js: 'import {createRequire} from "node:module";const require=createRequire(import.meta.url);',
      },
      plugins: [
        {
          name: "synthetic-canvas",
          setup(b) {
            b.onResolve({ filter: /^\.\/canvas\.ts$/ }, () => ({
              path: "canvas",
              namespace: "fixture",
            }));
            b.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
              contents: `
    export async function readCourses(){globalThis.__materialCalls.push('courses');return [{id:1,name:'Programming',course_code:'CS101'}]}
    export async function canvasRead(url){globalThis.__materialCalls.push(url);return {syllabus_body:'<p>Syllabus</p>'}}
    export async function canvasPages(url){globalThis.__materialCalls.push(url);if(url.includes('/quizzes'))throw Error('Canvas could not load your work (404).');if(url.includes('/assignments'))return [{id:2,name:'Lab 2',description:'<p>Reference</p>',html_url:'https://canvas.invalid/courses/1/assignments/2'}];return []}
   `,
            }));
          },
        },
      ],
    });
    const { collectMaterials } = await import(pathToFileURL(out).href);
    const observed = {
      checkedAt: new Date(0).toISOString(),
      resources: [],
      errors: [],
      responses: {
        "active-courses": {
          at: Date.now(),
          value: [{ id: 1, name: "Programming", course_code: "CS101" }],
        },
        "/api/v1/courses/1/assignments?include[]=submission&per_page=100": {
          at: Date.now(),
          value: [
            {
              id: 2,
              name: "Lab 2",
              description: "<p>Reference</p>",
              html_url: "https://canvas.invalid/courses/1/assignments/2",
            },
          ],
        },
      },
    };
    const first = await collectMaterials(
      new AbortController().signal,
      observed,
    );
    assert.ok(calls.length > 5);
    assert.equal(
      calls.includes("courses"),
      false,
      "Reuse the courses already loaded by the UI",
    );
    assert.equal(
      calls.some((key) => key.includes("/assignments")),
      false,
      "Reuse assignments already loaded by the UI",
    );
    calls.length = 0;
    const second = await collectMaterials(new AbortController().signal, first);
    assert.equal(calls.length, 0);
    const assignmentKey = Object.keys(second.responses).find((key) =>
      key.includes("/assignments"),
    )!;
    second.responses[assignmentKey].at -= 6 * 60 * 1000;
    calls.length = 0;
    const third = await collectMaterials(new AbortController().signal, second);
    assert.deepEqual(calls, [assignmentKey]);
    calls.length = 0;
    await collectMaterials(
      new AbortController().signal,
      third,
      undefined,
      true,
    );
    assert.ok(calls.some((key) => key.includes("/quizzes")));
  } finally {
    delete (globalThis as any).__materialCalls;
    await rm(folder, { recursive: true, force: true });
  }
});
