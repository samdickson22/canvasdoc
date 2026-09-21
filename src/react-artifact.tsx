import { useEffect, useRef, useState } from "react";
import { PencilLineIcon, RefreshCwIcon } from "lucide-react";
import { sandboxedReact } from "./html-preview";
import { useConnection, workspaceRequest } from "./runtime/client";
import type { ArtifactBundle } from "../companion/artifacts";

const fileLink = (path: string) => `[${path.split("/").pop()}](${encodeURI(path).replace(/#/g, "%23")})`;
/** Puts a request into this thread's composer so the student can edit or fix the artifact in chat. */
export const composeRequest = (threadId: string, text: string) =>
  window.dispatchEvent(new CustomEvent("canvasdoc:compose", { detail: { threadId, text } }));

export function ReactArtifactPreview({ path, modified, threadId }: { path: string; modified: number; threadId: string }) {
  const [bundle, setBundle] = useState<ArtifactBundle | null>(null);
  const [error, setError] = useState("");
  const [runtimeError, setRuntimeError] = useState("");
  const [version, setVersion] = useState(0);
  const frame = useRef<HTMLIFrameElement>(null);
  const { artifacts: supported } = useConnection();
  useEffect(() => {
    let cancelled = false;
    setBundle(null); setError(""); setRuntimeError("");
    if (!supported) { setError("Update canvasdoc-cli to preview React artifacts. Run npx canvasdoc-cli@latest, then reconnect."); return; }
    workspaceRequest<ArtifactBundle>("files-bundle", path)
      .then(result => { if (!cancelled) setBundle(result); })
      .catch(e => { if (!cancelled) setError((e as Error).message); });
    return () => { cancelled = true; };
  }, [path, modified, version, supported]);
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || event.data?.type !== "canvasdoc:artifact-error") return;
      setRuntimeError(previous => previous || String(event.data.message));
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);
  const problems = bundle?.errors.map(e => `${e.file ? `${e.file}${e.line ? `:${e.line}` : ""}: ` : ""}${e.text}`) ?? [];
  const fix = (detail: string) => composeRequest(threadId, `Fix ${fileLink(path)}. The preview reports: ${detail}`);
  return (
    <div className="artifact-preview">
      <div className="artifact-toolbar" role="toolbar" aria-label="Artifact actions">
        <button type="button" onClick={() => setVersion(v => v + 1)} disabled={!bundle && !error}><RefreshCwIcon size={13} /> Rebuild</button>
        <button type="button" onClick={() => composeRequest(threadId, `Update ${fileLink(path)}: `)}><PencilLineIcon size={13} /> Edit with Canvasdoc</button>
        {bundle?.warnings.length ? <span className="artifact-note">{bundle.warnings.length} warning{bundle.warnings.length === 1 ? "" : "s"}</span> : null}
      </div>
      {error ? (
        <div className="artifact-errors" role="alert"><p>Could not build this artifact.</p><pre>{error}</pre></div>
      ) : bundle && problems.length ? (
        <div className="artifact-errors" role="alert">
          <p>This artifact has {problems.length === 1 ? "a build error" : `${problems.length} build errors`}.</p>
          <pre>{problems.join("\n")}</pre>
          <button type="button" onClick={() => fix(problems.join("; "))}>Ask Canvasdoc to fix</button>
        </div>
      ) : bundle ? (
        <>
          {runtimeError && (
            <div className="artifact-errors artifact-runtime-error" role="alert">
              <pre>{runtimeError}</pre>
              <button type="button" onClick={() => fix(runtimeError)}>Ask Canvasdoc to fix</button>
            </div>
          )}
          <iframe ref={frame} className="workspace-pdf" title={path} sandbox="allow-scripts" referrerPolicy="no-referrer" srcDoc={sandboxedReact(bundle.js, bundle.css, path)} />
        </>
      ) : (
        <p className="workspace-file-hint" role="status">Building preview…</p>
      )}
    </div>
  );
}
