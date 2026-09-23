import {
  Download,
  File,
  FileText,
  FolderOpen,
  PanelRight,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Group, Panel, Separator } from "react-resizable-panels";
import remarkGfm from "remark-gfm";
import { sandboxedHtml } from "./html-preview.ts";
import { MaterialStatus } from "./material-status.tsx";
import { useConnection, workspaceRequest } from "./runtime/client.ts";
import { useData } from "./store.ts";
import { transitionView } from "./transitions.ts";
import type { PageContext } from "./types.ts";
import {
  belongsToAssignment,
  isSyncedSource,
  threadFileReferences,
} from "./workspace-files.ts";
function fileName(file: string): string {
  return file.startsWith("uploads/")
    ? file
        .split("/")
        .pop()!
        .replace(/^[a-f0-9]{64}-/, "")
    : file.split("/").pop()!;
}
type Entry = { path: string; size: number; modified: number };
type Preview = Entry & {
  mime: string;
  base64: string;
  previewKind?: string;
  notice?: string;
};
type WorkspaceProps = {
  context: PageContext;
  active: boolean;
  requestedFile?: { path: string };
  conversationHost: HTMLElement;
  onAssignment: () => void;
  onConnect: () => void;
};

export function Workspace({
  context,
  conversationHost,
  onAssignment,
  onConnect,
  requestedFile,
  active,
}: WorkspaceProps): React.JSX.Element {
  const connection = useConnection();
  const data = useData();
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [files, setFiles] = useState<Entry[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<"outputs" | "sources">("outputs");
  const refresh = useCallback(async () => {
    if (connection.status !== "connected" || !inspectorOpen || !active) return;
    try {
      const next = await workspaceRequest<Entry[]>("files-list");
      setFiles((prev) =>
        JSON.stringify(prev) === JSON.stringify(next) ? prev : next,
      );
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, [connection.status, inspectorOpen, active]);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 5000);
    return () => clearInterval(timer);
  }, [refresh]);
  const modified = files.find((f) => f.path === selected)?.modified;
  useEffect(() => {
    let cancelled = false;
    if (!selected) {
      setPreview(null);
      return;
    }
    if (connection.status !== "connected") return;
    setLoading(true);
    setError("");
    workspaceRequest<Preview>("files-read", selected)
      .then((result) => {
        if (!cancelled) setPreview(result);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selected, modified, connection.status]);
  const attach = useCallback(
    (node: HTMLDivElement | null) => {
      if (active && node && conversationHost.parentNode !== node)
        node.append(conversationHost);
    },
    [conversationHost, active],
  );
  const refs = threadFileReferences(
    data.threads[context.threadId]?.messages ?? [],
    connection.root,
  );
  const scoped = files.filter(
    (f) =>
      refs.has(f.path) ||
      (f.path.endsWith(".txt") && refs.has(f.path.slice(0, -4))) ||
      belongsToAssignment(f.path, context),
  );
  const isSource = (file: { path: string }) => isSyncedSource(file.path);
  const shown = scoped.filter(
    (f) =>
      (tab === "sources" ? isSource(f) : !isSource(f)) &&
      f.path.toLowerCase().includes(query.toLowerCase()),
  );
  useEffect(() => {
    if (!requestedFile) return;
    setInspectorOpen(true);
    setTab(isSyncedSource(requestedFile.path) ? "sources" : "outputs");
    setSelected(requestedFile.path);
  }, [requestedFile]);
  let emptyMessage =
    "Attach a file or ask the agent to link a source for this assignment.";
  if (query) emptyMessage = "No matching files.";
  else if (tab === "outputs")
    emptyMessage =
      "Files created or linked in this conversation will appear here.";
  function renderSelectedPreview(): React.JSX.Element | null {
    if (loading) {
      return <p className="workspace-file-hint">Loading preview…</p>;
    }
    if (preview && preview.path === selected) {
      return <FilePreview file={preview} />;
    }
    return null;
  }

  return (
    <section className="workbench" aria-label={`${context.title} workspace`}>
      <header className="workbench-header">
        <div>
          <FolderOpen size={18} />
          <strong>{context.title}</strong>
          <span>Workspace</span>
        </div>
        <div className="workbench-actions">
          <button
            className="connection-status"
            data-status={connection.status}
            onClick={onConnect}
          >
            <i />
            {connection.status === "connected" ? "Connected" : "Connect"}
          </button>
          <button
            className="workspace-inspector-toggle"
            aria-label={
              inspectorOpen
                ? "Hide workspace sidebar"
                : "Show workspace sidebar"
            }
            aria-expanded={inspectorOpen}
            onClick={() =>
              void transitionView(() => setInspectorOpen((v) => !v))
            }
          >
            <PanelRight size={18} />
          </button>
        </div>
      </header>
      <Group orientation="horizontal" className="workbench-split">
        <Panel id="conversation" defaultSize="70%" minSize="280px">
          <div className="workspace-conversation" ref={attach} />
        </Panel>
        <Separator
          className="workspace-divider"
          style={{ display: inspectorOpen ? undefined : "none" }}
        />
        <Panel
          id="inspector"
          defaultSize="30%"
          minSize={inspectorOpen ? "280px" : "0px"}
          maxSize={inspectorOpen ? "65%" : "0px"}
        >
          <div className="workspace-files" hidden={!inspectorOpen}>
            <header>
              <div className="workspace-file-tabs">
                <button
                  aria-pressed={tab === "outputs"}
                  onClick={() => void transitionView(() => setTab("outputs"))}
                >
                  Outputs{" "}
                  <small>{scoped.filter((f) => !isSource(f)).length}</small>
                </button>
                <button
                  aria-pressed={tab === "sources"}
                  onClick={() => void transitionView(() => setTab("sources"))}
                >
                  Sources{" "}
                  <small>{scoped.filter((f) => isSource(f)).length + 1}</small>
                </button>
              </div>
              <button
                aria-label="Close workspace sidebar"
                onClick={() =>
                  void transitionView(() => setInspectorOpen(false))
                }
              >
                <X size={16} />
              </button>
              <button
                aria-label="Refresh workspace files"
                title="Refresh files"
                onClick={() => void refresh()}
              >
                <RefreshCw size={16} />
              </button>
            </header>
            {connection.status !== "connected" ? (
              <div className="workspace-empty">
                <FolderOpen size={30} />
                <h3>Your files live on your computer.</h3>
                <p>
                  Connect to browse the Canvasdoc folder. Your conversation is
                  still saved in this browser.
                </p>
                <button onClick={onConnect}>Connect computer</button>
              </div>
            ) : (
              <>
                <label className="workspace-search">
                  <Search size={15} />
                  <input
                    aria-label="Find workspace files"
                    placeholder="Find a file…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </label>
                <div className="workspace-file-strip">
                  {tab === "sources" && <MaterialStatus />}
                  {tab === "sources" && (
                    <button className="workspace-source" onClick={onAssignment}>
                      <FileText size={16} />
                      <span>
                        Assignment in Canvas<small>Official requirements</small>
                      </span>
                    </button>
                  )}
                  {shown.map((f) => (
                    <button
                      key={f.path}
                      className="workspace-file-row"
                      aria-pressed={selected === f.path}
                      onClick={() =>
                        void transitionView(() => setSelected(f.path))
                      }
                    >
                      <File size={16} />
                      <span>
                        {fileName(f.path)}
                        <small>
                          {f.path.includes("/")
                            ? f.path.slice(0, f.path.lastIndexOf("/"))
                            : "Canvasdoc folder"}
                        </small>
                      </span>
                      <em>{Math.max(1, Math.round(f.size / 1024))} KB</em>
                    </button>
                  ))}
                  {!shown.length && (
                    <p className="workspace-file-hint">{emptyMessage}</p>
                  )}
                </div>
                {error && (
                  <p className="error" role="alert">
                    {error}
                  </p>
                )}
                {selected ? (
                  <div className="workspace-preview">
                    <header>
                      <span>{fileName(selected)}</span>
                      <button
                        aria-label="Close file preview"
                        onClick={() =>
                          void transitionView(() => setSelected(null))
                        }
                      >
                        <X size={16} />
                      </button>
                    </header>
                    {renderSelectedPreview()}
                  </div>
                ) : (
                  <p className="workspace-file-hint">
                    Select a file to preview.
                  </p>
                )}
              </>
            )}
          </div>
        </Panel>
      </Group>
    </section>
  );
}
type FilePreviewProps = { file: Preview };

function FilePreview({ file }: FilePreviewProps): React.JSX.Element {
  const [htmlSource, setHtmlSource] = useState(false);
  const [url, setUrl] = useState("");
  const bytes = Uint8Array.from(atob(file.base64), (c) => c.charCodeAt(0));
  const text = new TextDecoder().decode(bytes.subarray(0, 256 * 1024));
  const truncated = bytes.length > 256 * 1024;
  useEffect(() => {
    setHtmlSource(false);
    if (file.previewKind === "unavailable") {
      setUrl("");
      return;
    }
    const next = URL.createObjectURL(
      new Blob([Uint8Array.from(atob(file.base64), (c) => c.charCodeAt(0))], {
        type: file.mime,
      }),
    );
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  function renderPreview(): React.JSX.Element {
    if (file.previewKind === "unavailable") {
      return <p className="workspace-file-hint">{file.notice}</p>;
    }
    if (file.previewKind === "download") {
      return (
        <p className="workspace-file-hint">
          Preview is not available for this file type. Download it to open in
          its application.
        </p>
      );
    }
    if (file.previewKind === "html" && !htmlSource) {
      return (
        <iframe
          className="workspace-pdf"
          title={file.path}
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          srcDoc={sandboxedHtml(new TextDecoder().decode(bytes))}
        />
      );
    }
    if (file.mime.startsWith("image/")) {
      return (
        <img
          className="workspace-image"
          src={url || undefined}
          alt={file.path}
        />
      );
    }
    if (file.mime === "application/pdf") {
      return (
        <iframe
          className="workspace-pdf"
          src={url || undefined}
          title={file.path}
        />
      );
    }
    if (/\.(md|markdown)$/i.test(file.path)) {
      return (
        <div className="workspace-markdown">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
        </div>
      );
    }
    return (
      <pre className="workspace-text">
        <code>{text}</code>
      </pre>
    );
  }

  return (
    <>
      {file.previewKind !== "unavailable" && (
        <a
          className="workspace-download"
          href={url || undefined}
          download={fileName(file.path)}
        >
          <Download size={14} /> Download
        </a>
      )}
      {file.previewKind === "html" && (
        <button
          className="workspace-download"
          aria-pressed={htmlSource}
          onClick={() => setHtmlSource((v) => !v)}
        >
          {htmlSource ? "Preview" : "View source"}
        </button>
      )}
      {renderPreview()}
      {truncated &&
        ["text", "markdown"].includes(file.previewKind || "text") && (
          <p className="workspace-file-hint">
            Showing the first 256 KB. Download for the complete file.
          </p>
        )}
    </>
  );
}
