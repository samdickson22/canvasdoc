import { useEffect, useState } from "react";
import { useAuiState } from "@assistant-ui/react";
import type { SyntaxHighlighterProps } from "@assistant-ui/react-markdown";
import type { ThemedToken } from "./highlighter-entry";

type Highlighter = typeof import("./highlighter-entry");
let loader: Promise<Highlighter> | undefined;
// The grammars ship as a separate bundle so Canvas pages do not pay for them until a code block appears.
const loadHighlighter = () => loader ??= import(/* webpackIgnore: true */ typeof chrome !== "undefined" && chrome.runtime?.id
  ? chrome.runtime.getURL("highlighter/index.js") : "/canvasdoc/highlighter/index.js").catch(error => { loader = undefined; throw error; });
export const highlightMarkdownCode = (code: string, language: string) =>
  loadHighlighter().then(({ highlight }) => highlight(code, language));
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
