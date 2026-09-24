import { copyFile, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Markdown from 'react-markdown';

const output = 'release/public-site';
// Preserve the local Vercel project link between builds.
await mkdir(output, { recursive: true });
for (const directory of ['privacy', 'support'])
  await rm(`${output}/${directory}`, { recursive: true, force: true });
const pages = [
  ['privacy', 'Canvasdoc privacy policy', 'docs/privacy.md'],
  ['support', 'Canvasdoc support', 'docs/support.md'],
];
const css = `:root{color-scheme:dark;font-family:system-ui,sans-serif;background:#101310;color:#f2f5ef}*{box-sizing:border-box}body{margin:0}main{max-width:760px;margin:auto;padding:32px 24px 64px}nav{display:flex;gap:24px;padding-bottom:28px;border-bottom:1px solid #394137}nav a:first-child{margin-right:auto;font-weight:650}h1{font-size:clamp(1.8rem,5vw,2.6rem);line-height:1.15;letter-spacing:-.035em;margin-top:36px}h2{font-size:1.15rem;margin-top:32px}p,li{font-size:1rem;line-height:1.7;color:#d6ddd1}li+li{margin-top:12px}a{color:#b9ddb0;text-underline-offset:3px;overflow-wrap:anywhere}a:focus-visible{outline:2px solid #b9ddb0;outline-offset:4px}pre{margin:16px 0;padding:14px 16px;background:#1a1f19;border:1px solid #394137;border-radius:8px;overflow-x:auto}code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.9rem;color:#e6ecdf}pre code{white-space:pre}footer{margin-top:40px;padding-top:20px;border-top:1px solid #394137;color:#aeb8a8;font-size:.875rem}@media(max-width:420px){main{padding:24px 18px 48px}nav{gap:16px}}`;
function page(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="description" content="Canvasdoc privacy information and support."><title>${title}</title><style>${css}</style></head><body><main><nav aria-label="Main navigation"><a href="/">Canvasdoc</a><a href="/privacy/">Privacy</a><a href="/support/">Support</a></nav>${body}<footer>Canvasdoc · Sam Dickson</footer></main></body></html>`;
}
for (const [slug, title, source] of pages) {
  const markdown = await readFile(source, 'utf8');
  const body = renderToStaticMarkup(React.createElement(Markdown, {
    components: {
      a: ({ node, href, ...props }) => {
        const local = href === 'privacy.md' ? '/privacy/' : href === 'support.md' ? '/support/' : href;
        return React.createElement('a', { ...props, href: local, ...(local?.startsWith('https://') ? { target: '_blank', rel: 'noopener noreferrer' } : {}) });
      },
    },
  }, markdown));
  await mkdir(`${output}/${slug}`, { recursive: true });
  await writeFile(`${output}/${slug}/index.html`, page(title, body));
}
await writeFile(`${output}/index.html`, page('Canvasdoc privacy and support', '<h1>Canvasdoc</h1><p>A local coursework assistant inside Canvas. Currently supports Cal Poly and UCLA (BruinLearn) Canvas and requires a local companion and a Codex account.</p><p>Read the <a href="/privacy/">privacy policy</a> to understand local storage and model-provider processing, or visit <a href="/support/">support</a> for help.</p><p>Email <a href="mailto:sjedickson+canvasdoc@gmail.com">sjedickson+canvasdoc@gmail.com</a> for support or privacy requests.</p>'));
// The one-line installer referenced by the support page and the extension's setup prompt.
await copyFile('cli/install.sh', `${output}/install.sh`);
console.log(`Public site prepared in ${output}. Not published.`);
