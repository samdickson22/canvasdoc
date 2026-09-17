import { useEffect, useState } from "react";
import { useAuiState } from "@assistant-ui/react";
import type { SyntaxHighlighterProps } from "@assistant-ui/react-markdown";
import { createHighlighterCore, type ThemedToken } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import javascript from "shiki/langs/javascript.mjs";
import typescript from "shiki/langs/typescript.mjs";
import python from "shiki/langs/python.mjs";
import json from "shiki/langs/json.mjs";
import githubLight from "shiki/themes/github-light.mjs";

let highlighter: ReturnType<typeof createHighlighterCore> | undefined;
export async function highlightMarkdownCode(code: string, language: string) {
  const instance = await (highlighter ??= createHighlighterCore({
    themes: [githubLight],
    langs: [javascript, typescript, python, json],
    engine: createJavaScriptRegexEngine(),
  }));
  if (!instance.getLoadedLanguages().includes(language)) return null;
  return instance.codeToTokens(code, { lang: language, theme: "github-light" })
    .tokens;
}
export function MarkdownHighlighter({
  code,
  language,
  components: { Pre, Code },
  streaming = false,
}: SyntaxHighlighterProps & { streaming?: boolean }) {
  const [result, setResult] = useState<{
    code: string;
    language: string;
    tokens: ThemedToken[][];
  } | null>(null);
  useEffect(() => {
    if (streaming || !language) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void highlightMarkdownCode(code, language)
        .then((tokens) => {
          if (!cancelled && tokens) setResult({ code, language, tokens });
        })
        .catch(() => {
          /* Unknown grammars retain the readable plain-code fallback. */
        });
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [code, language, streaming]);
  const tokens =
    !streaming && result?.code === code && result.language === language
      ? result.tokens
      : null;
  return (
    <Pre>
      <Code>
        {tokens
          ? tokens.map((line, i) => (
              <span key={i}>
                {line.map((token, j) => (
                  <span
                    key={j}
                    style={{
                      color: token.color,
                      fontStyle:
                        token.fontStyle && token.fontStyle & 1
                          ? "italic"
                          : undefined,
                      fontWeight:
                        token.fontStyle && token.fontStyle & 2
                          ? "bold"
                          : undefined,
                    }}
                  >
                    {token.content}
                  </span>
                ))}
                {i < tokens.length - 1 ? "\n" : ""}
              </span>
            ))
          : code}
      </Code>
    </Pre>
  );
}
export function AssistantMarkdownHighlighter(props: SyntaxHighlighterProps) {
  const running = useAuiState(
    (s) => s.optional.part?.status.type === "running",
  );
  return <MarkdownHighlighter {...props} streaming={running} />;
}
