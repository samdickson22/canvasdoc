// Bundles a workspace .tsx/.jsx file into a self-contained React artifact for the sandboxed
// inspector preview. esbuild resolves react from the companion's own dependencies; every other
// import must stay inside the Canvasdoc folder.
import path from "node:path";
import { createRequire } from "node:module";
import { realpath, stat } from "node:fs/promises";
import { within } from "./files.ts";

export type ArtifactMessage = { text: string; file?: string; line?: number; column?: number };
export type ArtifactBundle = { js: string; css: string; errors: ArtifactMessage[]; warnings: ArtifactMessage[]; inputs: string[] };

const require = createRequire(import.meta.url);
const allowedPackages = /^(react|react-dom|scheduler)(\/.*)?$/;
const cache = new Map<string, { key: string; result: ArtifactBundle }>();
const OUTPUT_LIMIT = 8 * 1024 * 1024;

async function inputsKey(root: string, inputs: string[]) {
  const stats = await Promise.all(inputs.map(async file => {
    try { const info = await stat(path.join(root, file)); return `${file}:${info.mtimeMs}:${info.size}`; }
    catch { return `${file}:missing`; }
  }));
  return stats.join("|");
}

const format = (messages: { text: string; location?: { file?: string; line?: number; column?: number } | null }[]): ArtifactMessage[] =>
  messages.map(m => ({ text: m.text, ...(m.location?.file ? { file: m.location.file, line: m.location.line, column: m.location.column } : {}) }));

export async function bundleArtifact(root: string, relative: string): Promise<ArtifactBundle> {
  const entry = await within(root, relative);
  if (!/\.[jt]sx$/i.test(entry)) throw new Error("Only .tsx and .jsx files can be previewed as React artifacts.");
  const cached = cache.get(entry);
  if (cached && cached.key === await inputsKey(root, cached.result.inputs)) return cached.result;
  const esbuild = await import("esbuild");
  // The companion's node_modules. React resolves only from here, never from a node_modules above
  // the workspace (such as a stray ~/node_modules), so the artifact cannot mix two React copies.
  const companionModules = path.dirname(path.dirname(require.resolve("react/package.json")));
  const mount = `import * as artifact from ${JSON.stringify("./" + path.basename(entry))};
import { createElement, StrictMode } from "react";
import { createRoot } from "react-dom/client";
const App = artifact.default;
const container = document.getElementById("root");
if (typeof App === "function" || (App && typeof App === "object")) createRoot(container).render(createElement(StrictMode, null, createElement(App)));
else container.textContent = "Export a default React component from this file to preview it.";
`;
  const sandbox: import("esbuild").Plugin = {
    name: "canvasdoc-artifact-sandbox",
    setup(build) {
      build.onResolve({ filter: /.*/ }, async args => {
        if (args.kind === "entry-point" || args.pluginData?.sandboxed) return undefined;
        const spec = args.path;
        if (allowedPackages.test(spec))
          return build.resolve(spec, { kind: args.kind, resolveDir: companionModules, pluginData: { sandboxed: true } });
        // Files inside the allowed packages resolve their own internals normally.
        if (args.importer && !args.importer.startsWith(root + path.sep)) return undefined;
        if (/^(node:|https?:|data:|\/)/.test(spec)) return { errors: [{ text: `"${spec}" cannot be imported in an artifact. Use files inside the Canvasdoc folder.` }] };
        if (!spec.startsWith(".")) {
          return { errors: [{ text: `Package "${spec}" is not available. Artifacts can import react, react-dom, and files inside the Canvasdoc folder.` }] };
        }
        const resolved = await build.resolve(spec, { kind: args.kind, resolveDir: args.resolveDir, importer: args.importer, pluginData: { sandboxed: true } });
        if (resolved.errors.length) return { errors: resolved.errors };
        const real = await realpath(resolved.path).catch(() => resolved.path);
        if (!real.startsWith(root + path.sep) || path.relative(root, real).split(path.sep).some(p => p.startsWith(".")))
          return { errors: [{ text: `"${spec}" is outside the Canvasdoc folder and cannot be imported.` }] };
        return { path: real };
      });
    },
  };
  let result: import("esbuild").BuildResult;
  try {
    result = await esbuild.build({
      stdin: { contents: mount, resolveDir: path.dirname(entry), sourcefile: "canvasdoc-artifact-mount.tsx", loader: "tsx" },
      // write:false keeps output in memory; outdir only names the virtual JS and CSS files.
      bundle: true, write: false, metafile: true, outdir: path.join(root, ".canvasdoc", "artifact-build"), format: "iife", platform: "browser", target: "es2022",
      jsx: "automatic", minify: false, sourcemap: false, legalComments: "none", logLevel: "silent",
      define: { "process.env.NODE_ENV": '"production"' },
      loader: { ".png": "dataurl", ".jpg": "dataurl", ".jpeg": "dataurl", ".gif": "dataurl", ".webp": "dataurl", ".svg": "dataurl", ".md": "text", ".txt": "text", ".csv": "text" },
      absWorkingDir: root, plugins: [sandbox],
    });
  } catch (error) {
    const failure = error as { errors?: Parameters<typeof format>[0]; warnings?: Parameters<typeof format>[0] };
    if (!failure.errors) throw error;
    return { js: "", css: "", errors: format(failure.errors), warnings: format(failure.warnings ?? []), inputs: [path.relative(root, entry).split(path.sep).join("/")] };
  }
  const js = result.outputFiles?.find(f => f.path.endsWith(".js"))?.text ?? "";
  const css = result.outputFiles?.filter(f => f.path.endsWith(".css")).map(f => f.text).join("\n") ?? "";
  if (js.length + css.length > OUTPUT_LIMIT) return { js: "", css: "", errors: [{ text: "The bundled artifact exceeds 8 MB. Reduce embedded data or images." }], warnings: [], inputs: [path.relative(root, entry).split(path.sep).join("/")] };
  const inputs = Object.keys(result.metafile?.inputs ?? {}).filter(file => !file.startsWith("..") && !file.startsWith("<"));
  const bundle: ArtifactBundle = { js, css, errors: [], warnings: format(result.warnings), inputs };
  cache.set(entry, { key: await inputsKey(root, inputs), result: bundle });
  return bundle;
}
