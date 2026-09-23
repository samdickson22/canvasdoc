import { createContext, useContext, type ComponentProps } from "react";
import { useConnection } from "./runtime/client.ts";
import { localFilePath } from "./workspace-files.ts";
export const FileLinkThread = createContext("");
type WorkspaceLinkProps = ComponentProps<"a"> & { node?: unknown };

export function WorkspaceLink({
  href,
  children,
  node: _node,
  ...props
}: WorkspaceLinkProps): React.JSX.Element {
  const threadId = useContext(FileLinkThread);
  const { root } = useConnection();
  const path = href ? localFilePath(href, root) : null;
  return (
    <a
      {...props}
      href={href}
      onClick={(event) => {
        if (!path || !threadId) return;
        event.preventDefault();
        window.dispatchEvent(
          new CustomEvent("canvasdoc:open-file", {
            detail: { threadId, path },
          }),
        );
      }}
    >
      {children}
    </a>
  );
}
