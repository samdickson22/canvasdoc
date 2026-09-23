import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const out = "release/canvasdoc";
const { version, dependencies } = JSON.parse(
  await readFile("package.json", "utf8"),
);
const buildOptions = {
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  banner: {
    js: 'import { createRequire as __canvasdocCreateRequire } from "node:module"; const require = __canvasdocCreateRequire(import.meta.url);',
  },
};

await mkdir(out, { recursive: true });
for (const file of ["canvasdoc.mjs", "setup.mjs", "native-setup.mjs"]) {
  await copyFile(`cli/${file}`, `${out}/${file}`);
}

await build({
  ...buildOptions,
  entryPoints: ["companion/server.ts"],
  external: ["pdfjs-dist"],
  outfile: `${out}/connector.mjs`,
});
await build({
  ...buildOptions,
  entryPoints: ["companion/extract-worker.ts"],
  external: ["pdfjs-dist"],
  outfile: `${out}/extract-worker.mjs`,
});
await build({
  ...buildOptions,
  entryPoints: ["companion/native-host.ts"],
  outfile: `${out}/native-host.mjs`,
});

for (const file of ["connector.mjs", "native-host.mjs", "extract-worker.mjs"]) {
  execFileSync(process.execPath, ["--check", `${out}/${file}`], {
    stdio: "pipe",
  });
}

const packageManifest = {
  name: "canvasdoc-cli",
  version,
  description: "Local Canvasdoc setup and persistent Codex connector",
  type: "module",
  bin: { "canvasdoc-cli": "./canvasdoc.mjs" },
  engines: { node: ">=22.13" },
  files: [
    "canvasdoc.mjs",
    "setup.mjs",
    "connector.mjs",
    "native-host.mjs",
    "native-setup.mjs",
    "extract-worker.mjs",
    "README.md",
  ],
  dependencies: {
    "@openai/codex": "0.154.0",
    "pdfjs-dist": dependencies["pdfjs-dist"],
  },
};
await writeFile(
  `${out}/package.json`,
  JSON.stringify(packageManifest, null, 2),
);
await copyFile("cli/README.md", `${out}/README.md`);

if (process.argv.includes("--no-pack")) {
  console.log(`Built Canvasdoc CLI ${version} from this checkout.`);
  process.exit(0);
}

const artifacts = path.resolve("release/artifacts");
await mkdir(artifacts, { recursive: true });
const packed = JSON.parse(
  execFileSync(
    "npm",
    ["pack", path.resolve(out), "--pack-destination", artifacts, "--json"],
    { encoding: "utf8" },
  ),
);
const expected = [
  "README.md",
  "canvasdoc.mjs",
  "connector.mjs",
  "extract-worker.mjs",
  "native-host.mjs",
  "native-setup.mjs",
  "package.json",
  "setup.mjs",
];
const actual = packed[0].files.map((file) => file.path).sort();
if (JSON.stringify(actual) !== JSON.stringify(expected)) {
  throw new Error("Unexpected files in CLI package: " + actual.join(", "));
}
console.log(path.join(artifacts, packed[0].filename));
