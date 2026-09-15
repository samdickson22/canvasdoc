import type { PageContext, SavedMessage } from "./types.ts";

export function localFilePath(value: string, root?: string): string | null {
  let path: string;
  try {
    path = decodeURIComponent(value)
      .replace(/#.*$/, "")
      .replace(/:\d+(?::\d+)?$/, "");
  } catch {
    return null;
  }
  if (root && path.startsWith(root + "/")) path = path.slice(root.length + 1);
  path = path.replace(/^\.\//, "");
  if (
    !path ||
    path.startsWith("/") ||
    /^[a-z][a-z\d+.-]*:/i.test(path) ||
    /[\\\x00-\x1f]/.test(path) ||
    path.split("/").some((p) => !p || p.startsWith("."))
  )
    return null;
  return path;
}
export function threadFileReferences(
  messages: SavedMessage[],
  root?: string,
): Set<string> {
  const paths = new Set<string>();
  const add = (value: unknown) => {
    if (typeof value === "string") {
      const path = localFilePath(value, root);
      if (path) paths.add(path);
    }
  };
  for (const message of messages) {
    for (const path of message.files ?? []) add(path);
    // Explicit Markdown links, including angle-wrapped paths with spaces.
    for (const match of message.text.matchAll(
      /\[[^\]]*\]\((?:<([^>]+)>|([^\s)]+))(?:\s+"[^"]*")?\)/g,
    ))
      add(match[1] ?? match[2]);
    for (const part of message.parts ?? []) {
      if (
        part.type === "tool-call" &&
        part.toolName === "Edit files" &&
        !part.isError &&
        part.result !== undefined
      ) {
        const files = (part.args as any)?.files;
        if (Array.isArray(files)) for (const file of files) add(file.path);
      }
    }
    for (const attachment of message.attachments ?? [])
      for (const part of attachment.content) {
        if (part.type !== "text") continue;
        const match = part.text.match(
          /saved in the Canvasdoc folder at ("(?:\\.|[^"\\])*")\./,
        );
        if (match) {
          try {
            add(JSON.parse(match[1]));
          } catch {}
        }
      }
  }
  return paths;
}
export function belongsToAssignment(path: string, context: PageContext) {
  if (context.kind !== "assignment") return false;
  const parts = path.split("/");
  return (
    parts[0] === "courses" &&
    (parts[2] === `course-${context.courseId}` ||
      parts[2]?.endsWith(`--${context.courseId}`)) &&
    parts[3] === "assignments" &&
    (parts[4] === String(context.assignmentId) ||
      parts[4]?.endsWith(`--${context.assignmentId}`))
  );
}
export const isSyncedSource = (path: string) =>
  path.startsWith("uploads/") ||
  /^courses\/[^/]+\/[^/]+\/(materials\/|assignments\/[^/]+\/sources\/)/.test(
    path,
  );
