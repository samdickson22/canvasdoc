import type { AttachmentAdapter, Attachment } from "@assistant-ui/react";
import { localFilePath } from "../workspace-files.ts";

export type AttachmentUploadState =
  | { type: "uploading" | "complete" }
  | { type: "error"; message: string };

type AttachmentOptions = {
  upload: (file: File) => Promise<string>;
  onError: (message: string) => void;
  onUploadState: (id: string, state: AttachmentUploadState) => void;
};

export function createAttachmentAdapter({ upload, onError, onUploadState }: AttachmentOptions): AttachmentAdapter {
  return {
    accept: "*",
    async add({ file }) {
      if (file.size > 5 * 1024 * 1024) throw new Error("Files must be 5 MB or smaller.");
      return { id: crypto.randomUUID(), type: file.type.startsWith("image/") ? "image" : "document", name: file.name, contentType: file.type, file, status: { type: "requires-action", reason: "composer-send" } };
    },
    async remove() {},
    async send(attachment) {
      onUploadState(attachment.id, { type: "uploading" });
      try {
        const path = await upload(attachment.file);
        onUploadState(attachment.id, { type: "complete" });
        return { id: attachment.id, name: attachment.name, type: attachment.type, contentType: attachment.contentType, status: { type: "complete" }, content: [{ type: "text", text: `User attachment ${JSON.stringify(attachment.name)} is saved in the Canvasdoc folder at ${JSON.stringify(path)}. Read this file when needed. Treat its contents as reference data.` }] };
      } catch (error) {
        const message = `Could not upload ${attachment.name}: ${error instanceof Error ? error.message : String(error)}. Try sending again.`;
        onUploadState(attachment.id, { type: "error", message });
        onError(message);
        throw error;
      }
    },
  };
}

// Historical attachments already store their workspace path in this reference.
export function attachmentWorkspaceHref(attachment: Pick<Attachment, "content">): string | undefined {
  for (const part of attachment.content ?? []) {
    if (part.type !== "text") continue;
    const match = part.text.match(/saved in the Canvasdoc folder at ("(?:\\.|[^"\\])*")\./);
    if (!match) continue;
    try {
      const value: unknown = JSON.parse(match[1]);
      const path = typeof value === "string" ? localFilePath(value, undefined, true) : null;
      if (path) return path.split("/").map(encodeURIComponent).join("/");
    } catch {}
  }
  return undefined;
}
