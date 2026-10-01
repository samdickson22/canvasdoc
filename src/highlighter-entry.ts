// Built separately as dist/highlighter/index.js with one chunk per grammar, and
// imported on demand by the Markdown code renderer. Follows assistant-ui's
// shiki-highlighter element: Shiki with grammars loaded the first time a fenced
// block names their language, so Canvas pages never pay for the full grammar set.
import { createHighlighterCore, type ThemedToken } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import { bundledLanguages } from "shiki/langs";
import githubLight from "shiki/themes/github-light.mjs";

let highlighter: ReturnType<typeof createHighlighterCore> | undefined;
export type { ThemedToken };
/** Tokens for a fenced block, or null when Shiki has no grammar for the language. */
export async function highlight(code: string, language: string): Promise<ThemedToken[][] | null> {
  const lang = language.toLowerCase();
  const grammar = bundledLanguages[lang as keyof typeof bundledLanguages];
  if (!grammar) return null;
  const instance = await (highlighter ??= createHighlighterCore({
    themes: [githubLight],
    langs: [],
    engine: createJavaScriptRegexEngine({ forgiving: true }),
  }));
  if (!instance.getLoadedLanguages().includes(lang)) await instance.loadLanguage(grammar);
  return instance.codeToTokens(code, { lang, theme: "github-light" }).tokens;
}
