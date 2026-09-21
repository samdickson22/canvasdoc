/** Opaque-origin sandbox isolates artifacts; the policy blocks remote subresources. */
export function sandboxedHtml(html: string): string {
  return '<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'; img-src data: blob:; font-src data:; connect-src \'none\'; frame-src \'none\'; object-src \'none\'; form-action \'none\'; base-uri \'none\'"><meta name="referrer" content="no-referrer">' + html;
}

const artifactGuard = `window.addEventListener("error",function(e){report(e.message)});window.addEventListener("unhandledrejection",function(e){report(String(e.reason&&e.reason.message||e.reason))});function report(message){try{parent.postMessage({type:"canvasdoc:artifact-error",message:String(message)},"*")}catch(_){}var r=document.getElementById("root");if(r&&!r.childElementCount){var p=document.createElement("pre");p.className="canvasdoc-artifact-error";p.textContent="This artifact hit an error: "+message;r.appendChild(p)}}`;
const escapeHtml = (value: string) => value.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
/** A bundled React artifact in the same opaque-origin sandbox, with runtime errors reported to the parent. */
export function sandboxedReact(js: string, css: string, title: string): string {
  const inline = (code: string) => code.replace(/<\/(script|style)/gi, "<\\/$1");
  return sandboxedHtml(`<title>${escapeHtml(title)}</title><style>html,body{margin:0;min-height:100%;font-family:system-ui,-apple-system,sans-serif;color:#1f2a22;background:#fff}#root{min-height:100vh}.canvasdoc-artifact-error{margin:16px;padding:12px 14px;border-left:3px solid #b53535;background:#fff6f5;color:#8c2a2a;font:13px/1.5 ui-monospace,monospace;white-space:pre-wrap}</style><style>${inline(css)}</style><div id="root"></div><script>${artifactGuard}</script><script>${inline(js)}</script>`);
}
