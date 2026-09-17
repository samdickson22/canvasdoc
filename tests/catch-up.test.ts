import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { DOMParser } from "linkedom";

test("catch-up reads fresh Canvas sources and persists independent account comparisons", async (t) => {
  const folder = await mkdtemp(path.join(os.tmpdir(), "canvasdoc-catch-up-"));
  const disk = new Map<string, string>();
  Object.assign(globalThis, {
    location: { origin: "https://canvas.invalid" },
    window: new EventTarget(),
    localStorage: {
      getItem: (k: string) => disk.get(k) ?? null,
      setItem: (k: string, v: string) => disk.set(k, v),
    },
    DOMParser: class extends DOMParser {
      parseFromString(text: string, type: any) {
        return super.parseFromString(`<html><body>${text}</body></html>`, type);
      }
    },
  });
  let assignments = [
    {
      id: 2,
      name: "Lab",
      description: "Original spec",
      due_at: "2026-10-01T12:00:00Z",
      html_url: "https://canvas.invalid/courses/1/assignments/2",
      submission: { workflow_state: "unsubmitted" },
    },
  ];
  let fileRevision = "v1",
    pageBody = '<p>Page version one <a href="/courses/1/files/7">Spec</a></p>',
    failure = "";
  const calls: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: any) => {
    const url = new URL(String(input));
    calls.push(url.pathname);
    if (
      (failure === "files" && url.pathname.includes("/files")) ||
      failure === "auth" ||
      url.pathname.endsWith(failure || "NEVER")
    )
      return Response.json(
        { message: "Unavailable" },
        { status: failure === "auth" ? 401 : 503 },
      );
    if (url.pathname === "/api/v1/courses")
      return Response.json([{ id: 1, name: "Synthetic", course_code: "TEST" }]);
    if (url.pathname === "/api/v1/courses/1")
      return Response.json({ syllabus_body: "Syllabus" });
    if (url.pathname.endsWith("/assignments"))
      return Response.json(assignments);
    if (url.pathname.endsWith("/pages"))
      return Response.json([
        { page_id: 9, url: "guide", title: "Guide", updated_at: "2026-09-16" },
      ]);
    if (url.pathname.endsWith("/pages/guide"))
      return Response.json({ body: pageBody });
    if (url.pathname.endsWith("/files"))
      return Response.json([
        {
          id: 7,
          display_name: "spec.pdf",
          filename: "spec.pdf",
          updated_at: fileRevision,
          size: 10,
        },
      ]);
    return Response.json([]);
  });
  try {
    const entry = path.join(folder, "entry.ts"),
      out = path.join(folder, "entry.mjs");
    await writeFile(
      entry,
      `export {catchUp} from ${JSON.stringify(path.resolve("src/catch-up.ts"))}; export {store,initializeStore} from ${JSON.stringify(path.resolve("src/store.ts"))}; export {preferences} from ${JSON.stringify(path.resolve("src/preferences.ts"))};`,
    );
    await build({
      entryPoints: [entry],
      outfile: out,
      bundle: true,
      platform: "node",
      format: "esm",
      banner: {
        js: 'import {createRequire} from "node:module";const require=createRequire(import.meta.url);',
      },
    });
    const { catchUp, store, initializeStore, preferences } = await import(
      pathToFileURL(out).href
    );
    preferences.timeZone = "America/Los_Angeles";
    const run = () => catchUp(new AbortController().signal);
    await initializeStore("alice");
    failure = "auth";
    await run();
    assert.equal(store.get().catchUp.checkedAt, undefined);
    assert.equal(store.get().catchUp.digest.checked, 0);
    failure = "";
    await run();
    assert.equal(store.get().catchUp.digest.first, true);
    assert.match(store.get().catchUp.digest.items[0].detail, /5:00 AM/);
    assert.equal(
      store.get().catchUp.digest.items[0].href,
      "/courses/1/assignments/2",
    );
    assert.ok(calls.includes("/api/v1/courses/1/assignments"));
    await initializeStore("alice");
    await run();
    assert.equal(store.get().catchUp.digest.first, false);
    assert.deepEqual(store.get().catchUp.digest.items, []);
    failure = "files";
    await run();
    assert.deepEqual(store.get().catchUp.digest.items, []);
    assert.ok(store.get().catchUp.digest.coverage.length);
    pageBody += " Real source edit during outage.";
    await run();
    assert.equal(store.get().catchUp.digest.items.length, 1);
    assert.equal(store.get().catchUp.digest.items[0].id, "1:page:9");
    assert.match(
      store.get().catchUp.digest.items[0].detail,
      /Material updated/,
    );
    failure = "";
    await run();
    assert.deepEqual(store.get().catchUp.digest.items, []);
    assignments[0].due_at = "2026-10-02T12:00:00Z";
    assignments[0].description = "Revised spec";
    assignments[0].submission.workflow_state = "submitted";
    assignments.push({
      ...assignments[0],
      id: 3,
      name: "Outside modules",
      html_url: "https://canvas.invalid/courses/1/assignments/3",
    });
    fileRevision = "v2";
    await store.saveMaterials({
      checkedAt: new Date().toISOString(),
      resources: [],
      errors: [],
    });
    await run();
    const changed = store.get().catchUp.digest.items;
    assert.equal(changed.length, 3);
    assert.match(
      changed.find((x: any) => x.id === "1:assignment:2").detail,
      /Due date changed.*Submission or grade changed.*Requirements changed/,
    );
    assert.match(
      changed.find((x: any) => x.id === "1:assignment:3").detail,
      /New or newly available assignment/,
    );
    assert.match(
      changed.find((x: any) => x.id === "1:file:7").detail,
      /Material updated/,
    );
    failure = "/assignments";
    assignments[0].description = "Changed during outage";
    fileRevision = "v3";
    await run();
    assert.equal(store.get().catchUp.digest.items.length, 1);
    assert.ok(store.get().catchUp.digest.coverage.length);
    assert.ok(store.get().catchUp.baseline["1:assignment:2"]);
    failure = "";
    await run();
    assert.equal(store.get().catchUp.digest.items.length, 1);
    assert.match(
      store.get().catchUp.digest.items[0].detail,
      /Requirements changed/,
    );
    pageBody = "Page changed while body fails";
    failure = "/pages/guide";
    const pageBefore = store.get().catchUp.baseline["1:page:9"].revision;
    await run();
    assert.ok(
      store
        .get()
        .catchUp.digest.coverage.some((x: string) => x.includes("Guide")),
    );
    assert.equal(store.get().catchUp.baseline["1:page:9"].revision, pageBefore);
    failure = "";
    await run();
    assert.equal(store.get().catchUp.digest.items.length, 1);
    assert.equal(store.get().catchUp.digest.items[0].id, "1:page:9");
    await run();
    assert.deepEqual(store.get().catchUp.digest.items, []);
    const prior = JSON.stringify(store.get().catchUp.baseline);
    failure = "auth";
    await run();
    assert.equal(JSON.stringify(store.get().catchUp.baseline), prior);
    assert.equal(store.get().catchUp.digest.checked, 0);
    failure = "";
    await run();
    assert.deepEqual(store.get().catchUp.digest.items, []);
    assert.deepEqual(store.get().tasks, []);
    assert.deepEqual(store.get().threads, {});
    // A large first-run list remains five open assignments, nearest overdue first.
    assignments = Array.from({ length: 25 }, (_, i) => ({
      ...assignments[0],
      id: i + 10,
      due_at: new Date(Date.now() - (i + 1) * 86400000).toISOString(),
      submission: { workflow_state: i === 0 ? "submitted" : "unsubmitted" },
    }));
    await initializeStore("bob");
    assert.equal(store.get().catchUp, undefined);
    await run();
    assert.equal(store.get().catchUp.digest.first, true);
    assert.equal(store.get().catchUp.digest.items.length, 5);
    assert.equal(store.get().catchUp.digest.items[0].id, "1:assignment:11");
    await initializeStore("alice");
    assert.equal(JSON.stringify(store.get().catchUp.baseline), prior);
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(catchUp(controller.signal));
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});
