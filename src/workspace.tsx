import { createPortal } from "react-dom";
import { sandboxedHtml } from "./html-preview";
import { useData } from "./store";
import {
  belongsToAssignment,
  isSyncedSource,
  threadFileReferences,
} from "./workspace-files";
import { MaterialStatus } from "./material-status";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useCallback, useEffect, useReducer, useState } from "react";
import {
  Download,
  File,
  FileText,
  FolderOpen,
  RefreshCw,
  Search,
  PanelRight,
  X,
  Maximize2,
  Minimize2,
  FolderTree,
  ChevronRight,
  Plus,
} from "lucide-react";
import { useConnection, workspaceRequest } from "./runtime/client";
import { fileTabs, fileTree, type FileTreeNode } from "./workspace-layout";
import type { PageContext } from "./types";
const fileName = (file: string) =>
  file
    .split("/")
    .pop()!
    .replace(file.startsWith("uploads/") ? /^[a-f0-9]{64}-/ : /^$/, "");
type Entry = { path: string; size: number; modified: number };
type Preview = Entry & {
  mime: string;
  base64: string;
  previewKind?: string;
  notice?: string;
};
export function Workspace({
  toolbar,
  context,
  conversationHost,
  onAssignment,
  onConnect,
  requestedFile,
  active,
}: {
  toolbar: HTMLElement | null;
  context: PageContext;
  active: boolean;
  requestedFile?: { path: string };
  conversationHost: HTMLElement;
  onAssignment: () => void;
  onConnect: () => void;
}) {
  const connection = useConnection();
  const data = useData();
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [fileActions, setFileActions] = useState<HTMLDivElement | null>(null);
  const [maximized, setMaximized] = useState(false);
  const [explorerOpen, setExplorerOpen] = useState(true);
  const [tabs, dispatchTab] = useReducer(fileTabs, {
    paths: [],
    selected: null,
  });
  const selected = tabs.selected;
  const [files, setFiles] = useState<Entry[]>([]);
  const [previews, setPreviews] = useState<Record<string, Preview>>({});
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<"outputs" | "sources">("outputs");
  const [splitSize, setSplitSize] = useState(60);
  const [explorerSize, setExplorerSize] = useState(32);
  const viewerOnly = inspectorOpen && maximized;
  const showExplorer = explorerOpen || !selected;
  const openFile = useCallback((path: string) => {
    dispatchTab({ type: "open", path });
    setInspectorOpen(true);
  }, []);
  const hideViewer = () => {
    setInspectorOpen(false);
    setMaximized(false);
  };
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
      return;
    }
    if (connection.status !== "connected") return;
    setLoading(true);
    setError("");
    workspaceRequest<Preview>("files-read", selected)
      .then((result) => {
        if (!cancelled)
          setPreviews((previous) =>
            JSON.stringify(previous[selected]) === JSON.stringify(result)
              ? previous
              : { ...previous, [selected]: result },
          );
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
  const shown = scoped.filter(
    (f) =>
      (tab === "sources" ? isSyncedSource(f.path) : !isSyncedSource(f.path)) &&
      f.path.toLowerCase().includes(query.toLowerCase()),
  );
  const tree = fileTree(shown.map((f) => f.path));
  useEffect(() => {
    if (requestedFile) {
      openFile(requestedFile.path);
      setTab(isSyncedSource(requestedFile.path) ? "sources" : "outputs");
    }
  }, [requestedFile, openFile]);
  const closeTab = (path: string) => dispatchTab({ type: "close", path });
  return (
    <section
      className="workbench"
      aria-label={`${context.title} workspace`}
      data-viewer-maximized={viewerOnly || undefined}
    >
      {toolbar && createPortal(<>
        <strong className="workspace-title" title={context.title}>{context.title}</strong>
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
            aria-label={inspectorOpen ? "Hide file viewer" : "Show file viewer"}
            title={inspectorOpen ? "Hide file viewer" : "Show file viewer"}
            aria-expanded={inspectorOpen}
            onClick={() =>
              inspectorOpen ? hideViewer() : setInspectorOpen(true)
            }
          >
            <PanelRight size={18} />
          </button>
        </div>
      </>, toolbar)}
      <div
        className="workbench-split workspace-pane-grid"
        style={{
          gridTemplateColumns: !inspectorOpen
            ? "minmax(0, 1fr) 0px 0px"
            : viewerOnly
              ? "0px 0px minmax(0, 1fr)"
              : `minmax(0, ${100 - splitSize}fr) 4px minmax(0, ${splitSize}fr)`,
        }}
      >
        <div className="workspace-pane" id="workspace-conversation-pane">
          <div
            className="workspace-conversation"
            ref={attach}
            inert={viewerOnly}
            aria-hidden={viewerOnly || undefined}
          />
        </div>
        <WorkspaceResizeHandle
          label="Resize conversation and file viewer"
          value={100 - splitSize}
          onChange={(value) => setSplitSize(100 - value)}
          hidden={!inspectorOpen || viewerOnly}
        />
        <div className="workspace-pane" id="workspace-file-pane">
          <div
            className="workspace-files workspace-file-dock"
            hidden={!inspectorOpen}
          >
            <header className="workspace-tab-bar">
              <div
                className="workspace-open-tabs"
                role="tablist"
                aria-label="Open files"
              >
                {tabs.paths.map((path) => (
                  <div
                    className="workspace-open-tab"
                    data-active={selected === path || undefined}
                    key={path}
                  >
                    <button
                      role="tab"
                      aria-selected={selected === path}
                      title={path}
                      tabIndex={selected === path ? 0 : -1}
                      onClick={() => openFile(path)}
                      onKeyDown={(event) => {
                        const index = tabs.paths.indexOf(path);
                        const next =
                          event.key === "ArrowRight"
                            ? tabs.paths[(index + 1) % tabs.paths.length]
                            : event.key === "ArrowLeft"
                              ? tabs.paths[
                                  (index - 1 + tabs.paths.length) %
                                    tabs.paths.length
                                ]
                              : event.key === "Home"
                                ? tabs.paths[0]
                                : event.key === "End"
                                  ? tabs.paths[tabs.paths.length - 1]
                                  : null;
                        if (next) {
                          event.preventDefault();
                          openFile(next);
                          const buttons = event.currentTarget
                            .closest("[role=tablist]")
                            ?.querySelectorAll<HTMLButtonElement>("[role=tab]");
                          buttons?.[tabs.paths.indexOf(next)]?.focus();
                        }
                        if (event.key === "Delete") {
                          event.preventDefault();
                          closeTab(path);
                        }
                      }}
                    >
                      <File size={14} />
                      <span>{fileName(path)}</span>
                    </button>
                    <button
                      aria-label={`Close ${fileName(path)}`}
                      title="Close file"
                      onClick={() => closeTab(path)}
                    >
                      <X size={13} />
                    </button>
                  </div>
                ))}
                {!tabs.paths.length && (
                  <span className="workspace-tabs-empty">Files</span>
                )}
                <button
                  className="workspace-add-file"
                  aria-label="Browse files"
                  title="Browse files"
                  onClick={() => setExplorerOpen(true)}
                >
                  <Plus size={16} />
                </button>
              </div>
              <div className="workspace-view-controls">
                <button
                  aria-label={
                    viewerOnly ? "Restore split view" : "Expand file viewer"
                  }
                  title={
                    viewerOnly ? "Restore split view" : "Expand file viewer"
                  }
                  aria-pressed={viewerOnly}
                  onClick={() => setMaximized((v) => !v)}
                >
                  {viewerOnly ? (
                    <Minimize2 size={16} />
                  ) : (
                    <Maximize2 size={16} />
                  )}
                </button>
                <button
                  aria-label="Hide file viewer"
                  title="Hide file viewer"
                  onClick={hideViewer}
                >
                  <PanelRight size={16} />
                </button>
              </div>
            </header>
            <div className="workspace-file-toolbar">
              <nav className="workspace-breadcrumbs" aria-label="File path" title={selected ?? undefined}>
                {selected ? (
                  selected.split("/").slice(-2).map((part, index, array) => (
                    <span key={index}>
                      {index > 0 && <ChevronRight size={12} />}
                      <span
                        className={
                          index === array.length - 1
                            ? "current-file"
                            : undefined
                        }
                      >
                        {part}
                      </span>
                    </span>
                  ))
                ) : (
                  <span>Select a file</span>
                )}
              </nav>
              <div className="workspace-inline-actions" ref={setFileActions} />
              <button
                className="workspace-explorer-toggle"
                aria-label={
                  showExplorer ? "Hide file explorer" : "Show file explorer"
                }
                title={
                  showExplorer ? "Hide file explorer" : "Show file explorer"
                }
                aria-expanded={showExplorer}
                disabled={!selected}
                onClick={() => setExplorerOpen((v) => !v)}
              >
                <FolderTree size={16} />
              </button>
            </div>
            {error && (
              <p className="error workspace-file-error" role="alert">
                {error}
              </p>
            )}
            <div
              className="workspace-document-split workspace-pane-grid"
              style={{
                gridTemplateColumns: !selected
                  ? "0px 0px minmax(0, 1fr)"
                  : !showExplorer
                    ? "minmax(0, 1fr) 0px 0px"
                    : `minmax(0, ${100 - explorerSize}fr) 4px minmax(0, ${explorerSize}fr)`,
              }}
            >
              <div className="workspace-pane" id="workspace-document-pane">
                <div
                  className="workspace-preview workspace-document"
                  hidden={!selected}
                  role="tabpanel"
                  aria-label={selected ? fileName(selected) : "File preview"}
                >
                  {tabs.paths.map((path) => (
                    <div
                      key={path}
                      className="workspace-tab-content"
                      hidden={path !== selected}
                    >
                      {previews[path] ? (
                        <FilePreview file={previews[path]} actions={path === selected ? fileActions : null} />
                      ) : loading && path === selected ? (
                        <p className="workspace-file-hint">Loading preview…</p>
                      ) : (
                        <p className="workspace-file-hint">
                          Connect your computer to view this file.
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
              <WorkspaceResizeHandle
                label="Resize document and file explorer"
                value={100 - explorerSize}
                onChange={(value) => setExplorerSize(100 - value)}
                hidden={!selected || !showExplorer}
              />
              <div className="workspace-pane" id="workspace-explorer-pane">
                <aside
                  className="workspace-explorer"
                  aria-label="File explorer"
                  hidden={!showExplorer}
                >
                  <header>
                    <div className="workspace-file-tabs">
                      <button
                        aria-pressed={tab === "outputs"}
                        onClick={() => setTab("outputs")}
                      >
                        Outputs{" "}
                        <small>
                          {scoped.filter((f) => !isSyncedSource(f.path)).length}
                        </small>
                      </button>
                      <button
                        aria-pressed={tab === "sources"}
                        onClick={() => setTab("sources")}
                      >
                        Sources{" "}
                        <small>
                          {scoped.filter((f) => isSyncedSource(f.path)).length +
                            1}
                        </small>
                      </button>
                    </div>
                    <button
                      aria-label="Refresh workspace files"
                      title="Refresh files"
                      onClick={() => void refresh()}
                    >
                      <RefreshCw size={14} />
                    </button>
                  </header>
                  {connection.status !== "connected" ? (
                    <div className="workspace-empty">
                      <FolderOpen size={24} />
                      <p>Connect to browse your files.</p>
                      <button onClick={onConnect}>Connect computer</button>
                    </div>
                  ) : (
                    <>
                      <label className="workspace-search">
                        <Search size={14} />
                        <input
                          aria-label="Find workspace files"
                          placeholder="Search files"
                          value={query}
                          onChange={(event) => setQuery(event.target.value)}
                        />
                      </label>
                      <div className="workspace-file-tree">
                        {tab === "sources" && (
                          <>
                            <MaterialStatus />
                            <button
                              className="workspace-source"
                              onClick={onAssignment}
                            >
                              <FileText size={15} />
                              <span>
                                Assignment in Canvas
                                <small>Official requirements</small>
                              </span>
                            </button>
                          </>
                        )}
                        <FileTree
                          nodes={tree}
                          selected={selected}
                          openFile={openFile}
                          searching={!!query}
                        />
                        {!shown.length && (
                          <p className="workspace-file-hint">
                            {query
                              ? "No matching files."
                              : tab === "outputs"
                                ? "Files created or linked in this conversation will appear here."
                                : "Attach a file or ask the agent to link a source."}
                          </p>
                        )}
                      </div>
                    </>
                  )}
                </aside>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
function WorkspaceResizeHandle({
  label,
  value,
  onChange,
  hidden,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  hidden: boolean;
}) {
  const [dragging, setDragging] = useState(false);
  const update = (element: HTMLElement, clientX: number) => {
    const bounds = element.parentElement!.getBoundingClientRect();
    if (bounds.width > 0)
      onChange(
        Math.max(
          20,
          Math.min(80, ((clientX - bounds.left) / bounds.width) * 100),
        ),
      );
  };
  return (
    <div
      className="workspace-divider workspace-resizer"
      role="separator"
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemin={20}
      aria-valuemax={80}
      aria-valuenow={Math.round(value)}
      tabIndex={hidden ? -1 : 0}
      hidden={hidden}
      data-resizing={dragging || undefined}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        setDragging(true);
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          update(event.currentTarget, event.clientX);
      }}
      onPointerUp={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId);
        setDragging(false);
      }}
      onLostPointerCapture={() => setDragging(false)}
      onKeyDown={(event) => {
        const next =
          event.key === "ArrowLeft"
            ? value - 2
            : event.key === "ArrowRight"
              ? value + 2
              : event.key === "Home"
                ? 20
                : event.key === "End"
                  ? 80
                  : null;
        if (next !== null) {
          event.preventDefault();
          onChange(Math.max(20, Math.min(80, next)));
        }
      }}
    />
  );
}
function FileTree({
  nodes,
  selected,
  openFile,
  searching,
}: {
  nodes: FileTreeNode[];
  selected: string | null;
  openFile: (path: string) => void;
  searching: boolean;
}) {
  return (
    <ul className="workspace-tree-list">
      {nodes.map((node) => (
        <FileTreeItem
          key={node.path}
          node={node}
          selected={selected}
          openFile={openFile}
          searching={searching}
        />
      ))}
    </ul>
  );
}
function FileTreeItem({
  node,
  selected,
  openFile,
  searching,
}: {
  node: FileTreeNode;
  selected: string | null;
  openFile: (path: string) => void;
  searching: boolean;
}) {
  const [expanded, setExpanded] = useState(true);
  return (
    <li>
      {node.children ? (
        <>
          <button
            className="workspace-tree-folder"
            aria-expanded={expanded || searching}
            onClick={() => setExpanded((v) => !v)}
          >
            <ChevronRight
              size={14}
              className={expanded || searching ? "expanded" : undefined}
            />
            <FolderOpen size={14} />
            <span>{node.name}</span>
          </button>
          {(expanded || searching) && (
            <FileTree
              nodes={node.children}
              selected={selected}
              openFile={openFile}
              searching={searching}
            />
          )}
        </>
      ) : (
        <button
          className="workspace-tree-file"
          title={node.path}
          aria-pressed={selected === node.path}
          onClick={() => openFile(node.path)}
        >
          <File size={14} />
          <span>{fileName(node.path)}</span>
        </button>
      )}
    </li>
  );
}
function FilePreview({ file, actions }: { file: Preview; actions: HTMLElement | null }) {
  const [htmlSource, setHtmlSource] = useState(false);
  const [url, setUrl] = useState("");
  const bytes = Uint8Array.from(atob(file.base64), (c) => c.charCodeAt(0));
  const text = new TextDecoder().decode(bytes.subarray(0, 256 * 1024));
  const truncated = bytes.length > 256 * 1024;
  useEffect(() => {
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
  return (
    <>
      {actions && createPortal(<div className="workspace-file-actions">
        {file.previewKind !== "unavailable" && (
          <a
            className="workspace-download"
            aria-label="Download file"
            title="Download file"
            href={url || undefined}
            download={fileName(file.path)}
          >
            <Download size={14} />
          </a>
        )}
        {file.previewKind === "html" && (
          <div className="workspace-artifact-views" aria-label="Artifact view">
            <button
              aria-pressed={!htmlSource}
              onClick={() => setHtmlSource(false)}
            >
              Preview
            </button>
            <button
              aria-pressed={htmlSource}
              onClick={() => setHtmlSource(true)}
            >
              Source
            </button>
          </div>
        )}
      </div>, actions)}
      {file.previewKind === "unavailable" ? (
        <p className="workspace-file-hint">{file.notice}</p>
      ) : file.previewKind === "download" ? (
        <p className="workspace-file-hint">
          Preview is not available for this file type. Download it to open in
          its application.
        </p>
      ) : file.previewKind === "html" && !htmlSource ? (
        <iframe
          className="workspace-pdf"
          title={file.path}
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          srcDoc={sandboxedHtml(new TextDecoder().decode(bytes))}
        />
      ) : file.mime.startsWith("image/") ? (
        <img
          className="workspace-image"
          src={url || undefined}
          alt={file.path}
        />
      ) : file.mime === "application/pdf" ? (
        <iframe
          className="workspace-pdf"
          src={url || undefined}
          title={file.path}
        />
      ) : /\.(md|markdown)$/i.test(file.path) ? (
        <div className="workspace-markdown">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
        </div>
      ) : (
        <pre className="workspace-text">
          <code>{text}</code>
        </pre>
      )}
      {truncated &&
        ["text", "markdown"].includes(file.previewKind || "text") && (
          <p className="workspace-file-hint">
            Showing the first 256 KB. Download for the complete file.
          </p>
        )}
    </>
  );
}
