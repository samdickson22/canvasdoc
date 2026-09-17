import { context, build as bundle } from "esbuild";
import { mkdir, writeFile, copyFile, readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";

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
          await bundle({
            entryPoints: ["extension/background.ts"],
            outfile: `${output}/background.js`,
            bundle: true,
            format: "iife",
            target: "chrome120",
            minify: true,
          });
          await copyFile("extension/manifest.json", `${output}/manifest.json`);
          await copyFile("extension/bootstrap.js", `${output}/bootstrap.js`);
          await copyFile("extension/bootstrap.css", `${output}/bootstrap.css`);
          const version = String(Date.now());
          await writeFile(
            `${output}/version.json`,
            JSON.stringify({ version }),
          );
          if (existsSync(resolve("dev/canvas-lms/public"))) {
            await mkdir(devOutput, { recursive: true });
            await copyFile(`${output}/bootstrap.js`, `${devOutput}/bootstrap.js`);
            await copyFile(`${output}/bootstrap.css`, `${devOutput}/bootstrap.css`);
            await copyFile(
              `${output}/canvasdoc.js`,
              `${devOutput}/canvasdoc.js`,
            );
            await copyFile(
              `${output}/version.json`,
              `${devOutput}/version.json`,
            );
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
