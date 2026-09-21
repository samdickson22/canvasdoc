// Adapted from assistant-ui's elements-mermaid-diagram; beautiful-mermaid renders without a DOM.
import { useEffect, useState, type FC } from "react";
import { cn } from "../../../lib/utils";

type Renderer = typeof import("../../../../mermaid-entry");
let renderer: Promise<Renderer> | undefined;
// The renderer ships as a separate bundle so Canvas pages do not pay for it until a diagram appears.
const loadRenderer = () => renderer ??= import(/* webpackIgnore: true */ typeof chrome !== "undefined" && chrome.runtime?.id
  ? chrome.runtime.getURL("mermaid.js") : "/canvasdoc/mermaid.js").catch(error => { renderer = undefined; throw error; });

export const MermaidDiagram: FC<{ code: string; streaming?: boolean; className?: string }> = ({ code, streaming = false, className }) => {
  const [result, setResult] = useState<{ svg: string; error: string } | null>(null);
  useEffect(() => {
    setResult(null);
    if (streaming) return;
    let cancelled = false;
    loadRenderer()
      .then(({ renderMermaidSVG }) => ({ svg: renderMermaidSVG(code, { bg: "#ffffff", fg: "#26322b", muted: "#788176", border: "#dce2d8", accent: "#234a37", transparent: true }), error: "" }))
      .catch(error => ({ svg: "", error: error instanceof Error ? error.message : String(error) }))
      .then(next => { if (!cancelled) setResult(next); });
    return () => { cancelled = true; };
  }, [streaming, code]);
  if (!result)
    return <div data-slot="mermaid-skeleton" aria-label="Rendering diagram" className={cn("bg-muted flex h-32 animate-pulse items-center justify-center gap-3 rounded-lg p-4 motion-reduce:animate-none", className)}>
      {[0, 1, 2].map(i => <div key={i} className="bg-muted-foreground/20 h-8 w-20 rounded-md" />)}
    </div>;
  if (result.error)
    return <div data-slot="mermaid-fallback" className={cn("bg-muted/75 rounded-lg", className)}>
      <pre className="m-0 overflow-x-auto p-4 text-sm">{code.trim()}</pre>
      <p className="text-muted-foreground border-border m-0 border-t px-4 py-1.5 text-xs">Diagram could not be rendered: {result.error}</p>
    </div>;
  return <div data-slot="mermaid-diagram" className={cn("bg-muted overflow-x-auto rounded-lg p-3 [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full", className)} dangerouslySetInnerHTML={{ __html: result.svg }} />;
};
