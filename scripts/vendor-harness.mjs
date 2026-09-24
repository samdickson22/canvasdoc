// Usage: node scripts/vendor-harness.mjs /path/to/harness-sdk-checkout
import {
  readdir,
  readFile,
  writeFile,
  mkdir,
  copyFile,
} from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
const source = process.argv[2];
const commit = "c189c339ec82dbdce76dfead269b55b2d719c9e0";
if (
  !source ||
  execFileSync("git", ["-C", source, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim() !== commit
)
  throw Error("Use the pinned Harness checkout " + commit);
for (const [name, dir, entries] of [
  ["harness-sdk", "core", ["index", "host", "runs", "ui-transport"]],
  [
    "@harness-sdk/codex",
    "codex",
    ["index", "node", "protocol", "projection", "json"],
  ],
]) {
  const from = path.join(source, "packages/harness-sdk", dir, "src");
  const to = path.join(
    "companion/vendor",
    dir === "core" ? "harness-core" : "harness-codex",
  );
  async function copy(relative = "") {
    await mkdir(path.join(to, relative), { recursive: true });
    for (const entry of await readdir(path.join(from, relative), {
      withFileTypes: true,
    })) {
      const file = path.join(relative, entry.name);
      if (entry.isDirectory()) {
        await copy(file);
        continue;
      }
      let text = await readFile(path.join(from, file), "utf8");
      // Node's direct TypeScript execution requires explicit relative extensions.
      text = text.replace(
        /(from\s+["'])(\.[^"']+)(["'])/g,
        (_, a, p, b) => a + p + (/\.[a-z]+$/.test(p) ? "" : ".ts") + b,
      );
      await writeFile(path.join(to, file), text);
    }
  }
  await copy();
  await copyFile(path.join(source, "LICENSE"), path.join(to, "LICENSE"));
  await writeFile(
    path.join(to, "package.json"),
    JSON.stringify(
      {
        name,
        version: dir === "core" ? "0.3.1" : "0.0.1",
        private: true,
        type: "module",
        license: "MIT",
        exports: Object.fromEntries(
          entries.map((e) => [
            e === "index" ? "." : "./" + e,
            "./" + e + ".ts",
          ]),
        ),
        dependencies: {
          "@assistant-ui/tap": "0.9.17",
          statewire: "0.19.1",
          ...(dir === "codex"
            ? { "harness-sdk": "file:../harness-core", ws: "^8.21.3" }
            : {}),
        },
        peerDependencies: { react: "^19" },
        canvasdocUpstream: {
          repository: "https://github.com/assistant-ui/harness-sdk",
          commit,
        },
      },
      null,
      2,
    ) + "\n",
  );
}
