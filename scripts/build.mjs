import { context, build as bundle } from "esbuild";
import { mkdir, writeFile, copyFile, readFile, cp, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { withOrigins } from "./manifest-origins.mjs";

const watch = process.argv.includes("--watch");
const output = resolve("dist");
const devOutput = resolve("dev/canvas-lms/public/canvasdoc");
await mkdir(output, { recursive: true });
const build = await context({
  entryPoints: ["src/index.tsx"],
  outfile: `${output}/canvasdoc.js`,
  bundle: true,
  format: "iife",
  target: "chrome120",
  jsx: "automatic",
  loader: { ".css": "text" },
  define: { "process.env.NODE_ENV": '"production"' },
  minify: true,
  plugins: [
    {
      name: "katex-embedded-fonts",
      setup(build) {
        build.onLoad({filter: /katex\.min\.css$/}, async ({path}) => {
          let css = (await readFile(path, "utf8")).replace(/,url\([^)]+\) format\("(?:woff|truetype)"\)/g, "");
          for (const match of [...css.matchAll(/url\(([^)]+)\)/g)]) {
            const font = await readFile(resolve(dirname(path), match[1]));
            const mime = match[1].endsWith(".woff2") ? "font/woff2" : match[1].endsWith(".woff") ? "font/woff" : "font/ttf";
            css = css.replace(match[0], `url(data:${mime};base64,${font.toString("base64")})`);
          }
          return {contents: css, loader: "text"};
        });
      },
    },
    {
      name: "copy-to-dev-canvas",
      setup(build) {
        build.onStart(() => {
          execFileSync(process.execPath, ["node_modules/@tailwindcss/cli/dist/index.mjs", "-i", "src/assistant-ui/theme.css", "-o", "dist/assistant-ui.css", "--minify"], { stdio: "pipe" });
        });
        build.onEnd(async (result) => {
          if (result.errors.length) return;
          await rm(`${output}/pdf`, { recursive: true, force:true });
          await mkdir(`${output}/pdf`, { recursive: true });
          await bundle({entryPoints:["src/pdf-viewer.ts"],outfile:`${output}/pdf/viewer.js`,bundle:true,format:"iife",target:"chrome120",minify:true});
          await copyFile("extension/pdf-viewer.html", `${output}/pdf/viewer.html`);
          await bundle({entryPoints:["src/mermaid-entry.ts"],outfile:`${output}/mermaid.js`,bundle:true,format:"esm",target:"chrome120",minify:true});
          await copyFile("node_modules/pdfjs-dist/build/pdf.worker.mjs", `${output}/pdf/pdf.worker.js`);
          await copyFile("node_modules/pdfjs-dist/LICENSE", `${output}/pdf/LICENSE`);
          for (const directory of ["cmaps", "standard_fonts", "wasm"])
            await cp(`node_modules/pdfjs-dist/${directory}`, `${output}/pdf/${directory}`, { recursive:true });
          await bundle({
            entryPoints: ["extension/background.ts"],
            outfile: `${output}/background.js`,
            bundle: true,
            format: "iife",
            target: "chrome120",
            minify: true,
          });
          for (const file of ["bootstrap.js", "bootstrap.css", "icon-16.png", "icon-32.png", "icon-48.png", "icon-128.png"]) {
            await copyFile(`extension/${file}`, `${output}/${file}`);
          }
          const manifest = JSON.parse(await readFile("extension/manifest.json", "utf8"));
          const metadata = JSON.parse(await readFile("package.json", "utf8"));
          const origins = JSON.parse(await readFile("extension/origins.json", "utf8"));
          await writeFile(`${output}/manifest.json`, JSON.stringify({ ...withOrigins(manifest, [...origins.development, ...origins.canvas.map((school) => school.origin)]), version: metadata.version }, null, 2));
          await rm(`${output}/notices`, { recursive: true, force: true });
          await mkdir(`${output}/notices`, { recursive: true });
          for (const [source, name] of [
            ["LICENSE", "CANVASDOC-LICENSE"],
            ["src/assistant-ui/LICENSE", "ASSISTANT-UI-LICENSE"],
            ["src/bettercampus/LICENSE", "TASKS-FOR-CANVAS-LICENSE"],
            ["src/bettercampus/README.md", "TASKS-FOR-CANVAS-ATTRIBUTION.md"],
          ]) await copyFile(source, `${output}/notices/${name}`);
          const version = String(Date.now());
          await writeFile(
            `${output}/version.json`,
            JSON.stringify({ version }),
          );
          if (existsSync(resolve("dev/canvas-lms/public"))) {
            await mkdir(devOutput, { recursive: true });
            for (const file of ["bootstrap.js", "bootstrap.css", "canvasdoc.js", "mermaid.js", "version.json"]) {
              await copyFile(`${output}/${file}`, `${devOutput}/${file}`);
            }
            await rm(`${devOutput}/pdf`, { recursive:true, force:true });
            await cp(`${output}/pdf`, `${devOutput}/pdf`, { recursive:true });
          }
          console.log(`Canvasdoc built ${new Date().toLocaleTimeString()}`);
        });
      },
    },
  ],
});
if (watch) {
  await build.watch();
  console.log("Watching src/. Reload the dev Canvas tab to see changes.");
} else {
  await build.rebuild();
  await build.dispose();
}
