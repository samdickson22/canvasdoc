import { isLocalFileLink, localFilePath } from "./workspace-files.ts";

/** Resolve Markdown document references without ever granting access outside the root. */
export function markdownWorkspacePath(
  href: string,
  root?: string,
  documentPath?: string,
): string | null {
  if (!isLocalFileLink(href)) return null;
  if (href.startsWith("/") || /^[a-z]:[\\/]|^file:/i.test(href)) return localFilePath(href, root);
  let decoded: string;
  try {
    decoded = decodeURIComponent(
      href.replace(/#.*$/, "").replace(/:\d+(?::\d+)?$/, ""),
    );
  } catch {
    return null;
  }
  if (root && /^(?:[a-z]:[\\/]|\\\\)/i.test(root)) decoded = decoded.replaceAll("\\", "/");
  if (
    /^[a-z][a-z\d+.-]*:/i.test(decoded) ||
    /[\\\x00-\x1f]/.test(decoded) ||
    decoded.startsWith("/")
  )
    return null;
  const parts = documentPath ? documentPath.split("/").slice(0, -1) : [];
  for (const part of decoded.split("/")) {
    if (part === ".") continue;
    if (part === "..") {
      if (!parts.length) return null;
      parts.pop();
    } else if (!part || part.startsWith(".")) return null;
    else parts.push(part);
  }
  return localFilePath(parts.join("/"), root, true);
}
