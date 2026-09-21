import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { bundleArtifact } from "../companion/artifacts.ts";

test("react artifacts bundle with react and workspace files only", async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "canvasdoc-artifact-")));
  try {
    await mkdir(path.join(root, "outputs"));
    await writeFile(path.join(root, "outputs/quiz.css"), ".quiz{color:rebeccapurple}");
    await writeFile(path.join(root, "outputs/data.json"), JSON.stringify({ questions: ["2+2"] }));
    await writeFile(path.join(root, "outputs/quiz.tsx"), `import { useState } from "react";
import data from "./data.json";
import "./quiz.css";
export default function Quiz() { const [i, set] = useState(0); return <div className="quiz" onClick={() => set(i + 1)}>{data.questions[0]} {i}</div>; }`);
    const bundle = await bundleArtifact(root, "outputs/quiz.tsx");
    assert.deepEqual(bundle.errors, []);
    assert.match(bundle.js, /createRoot/);
    assert.match(bundle.js, /2\+2/);
    assert.match(bundle.css, /rebeccapurple/);
    assert.ok(bundle.inputs.includes("outputs/quiz.tsx"));
    assert.equal(await bundleArtifact(root, "outputs/quiz.tsx"), bundle, "unchanged inputs hit the cache");

    await writeFile(path.join(root, "outputs/bad.tsx"), `import _ from "lodash";\nexport default () => <div>{_.chunk([1], 1).length}</div>;`);
    const missing = await bundleArtifact(root, "outputs/bad.tsx");
    assert.match(missing.errors[0].text, /Package "lodash" is not available/);

    await writeFile(path.join(root, "outputs/escape.tsx"), `import secret from "../../outside.txt";\nexport default () => <div>{secret}</div>;`);
    await writeFile(path.join(path.dirname(root), "outside.txt"), "nope");
    const escape = await bundleArtifact(root, "outputs/escape.tsx");
    assert.equal(escape.js, "");
    assert.ok(escape.errors.some(e => /outside the Canvasdoc folder|Could not resolve/.test(e.text)), JSON.stringify(escape.errors));

    await writeFile(path.join(root, "outputs/plain.md"), "# not code");
    await assert.rejects(bundleArtifact(root, "outputs/plain.md"), /Only \.tsx and \.jsx/);
    await assert.rejects(bundleArtifact(root, "../outputs/quiz.tsx"));
  } finally {
    await rm(path.join(path.dirname(root), "outside.txt"), { force: true });
    await rm(root, { recursive: true, force: true });
  }
});

test("the companion answers files-bundle over the connector socket", { timeout: 20000 }, async () => {
  const { mkdtemp: tmp } = await import("node:fs/promises");
  const { connector } = await import("./fixtures/connector.ts");
  const workspace = await realpath(await tmp(path.join(os.tmpdir(), "canvasdoc-artifact-socket-")));
  const fixture = await connector(workspace, "lifecycle");
  try {
    await fixture.start();
    const connection = await fixture.connect();
    await mkdir(path.join(workspace, "outputs"), { recursive: true });
    await writeFile(path.join(workspace, "outputs/cards.tsx"), `export default function Cards() { return <button>Flip</button>; }`);
    connection.send({ type: "files-bundle", id: "bundle-1", path: "outputs/cards.tsx" });
    const reply = await connection.wait(message => message.type === "files-result" && message.id === "bundle-1");
    assert.equal(reply.error, undefined, reply.error);
    assert.deepEqual(reply.result.errors, []);
    assert.match(reply.result.js, /Flip/);
    connection.send({ type: "files-bundle", id: "bundle-2", path: "../outside.tsx" });
    const rejected = await connection.wait(message => message.type === "files-result" && message.id === "bundle-2");
    assert.ok(rejected.error);
  } finally {
    await fixture.close();
    await rm(workspace, { recursive: true, force: true });
  }
});
