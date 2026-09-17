import { createContext, useContext, useState, type ComponentProps } from "react";
import { useConnection, workspaceRequest } from "./runtime/client";
import { isLocalFileLink, localFilePath } from "./workspace-files";
import { prepareWorkspaceDownload } from "./workspace-download";
export const FileLinkThread = createContext("");
export function WorkspaceLink({
  href,
  children,
  node: _node,
  ...props
}: ComponentProps<"a"> & { node?: unknown }) {
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const threadId = useContext(FileLinkThread);
  const { root, status } = useConnection();
  const path = href ? localFilePath(href, root) : null;
  return (
    <>
    <a
      {...props}
      href={href}
      aria-busy={loading || undefined}
      onClick={async (event) => {
        if (!href || !isLocalFileLink(href)) return;
        event.preventDefault();
        if (!path) {
          setError(status !== "connected" ? "Connect your computer to open this file." : "File unavailable: path is outside the accessible Canvasdoc folder.");
          return;
        }
        if (threadId) {
          window.dispatchEvent(new CustomEvent("canvasdoc:open-file", { detail: { threadId, path } }));
          return;
        }
        if (loading) return;
        setError("");
        setLoading(true);
        try {
          const file = await prepareWorkspaceDownload(path, path => workspaceRequest("files-read", path));
          const url = URL.createObjectURL(file.blob);
          const link = document.createElement("a");
          link.href = url;
          link.download = file.name;
          link.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        } catch (error) {
          setError(`File unavailable: ${(error as Error).message}`);
        } finally {
          setLoading(false);
        }
      }}
    >
      {children}
    </a>
    {error && <span role="alert"> {error}</span>}
    </>
  );
}
