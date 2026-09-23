/** Opaque-origin sandbox isolates artifacts; the policy blocks remote subresources. */
export function sandboxedHtml(html: string): string {
  return (
    "<!doctype html><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'\"><meta name=\"referrer\" content=\"no-referrer\">" +
    html
  );
}
