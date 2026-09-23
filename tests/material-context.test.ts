import { build } from "esbuild";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
test("a stalled material collector cannot block a chat context snapshot", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "canvasdoc-context-"));
  try {
    const outfile = path.join(directory, "context.mjs");
    await build({
      entryPoints: ["src/material-sync.ts"],
      outfile,
      bundle: true,
      format: "esm",
      platform: "node",
      plugins: [
        {
          name: "stalled-collector",
          setup(b) {
            b.onResolve(
              {
                filter:
                  /^(react|\.\/material-collector\.ts|\.\/store\.ts|\.\/runtime\/client\.ts)$/,
              },
              (args) => ({ path: args.path, namespace: "stub" }),
            );
            const stubs: Record<string, string> = {
              react: "export const useSyncExternalStore=()=>{}",
              "./material-collector.ts":
                "export const collectMaterials=()=>new Promise(()=>{});export const sha256=()=>{}",
              "./store.ts":
                'export const store={account:()=>"test",get:()=>({}),saveMaterials:()=>{}}',
              "./runtime/client.ts":
                'export const connectionState=()=>({status:"disconnected"});export const materialRequest=()=>{};export const subscribeConnection=()=>()=>{}',
            };
            b.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({
              contents: stubs[args.path],
            }));
          },
        },
      ],
    });
    const { materialContext } = await import(pathToFileURL(outfile).href);
    const context = materialContext(1);
    assert.equal(typeof context, "string");
    assert.match(context, /Use directory listings and search/);
    assert.match(context, /not confirmed in this browser session/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
