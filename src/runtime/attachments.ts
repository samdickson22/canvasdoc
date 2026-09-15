import type { AttachmentAdapter } from "@assistant-ui/react";
import { uploadFile } from "./client";

export const attachmentAdapter: AttachmentAdapter = {
  accept: "*",
  async add({ file }) {
    if (file.size > 5 * 1024 * 1024) throw new Error("Files must be 5 MB or smaller.");
    return { id: crypto.randomUUID(), type: file.type.startsWith("image/") ? "image" : "document", name: file.name, contentType: file.type, file, status: { type: "requires-action", reason: "composer-send" } };
  },
  async remove() {},
  async send(attachment) {
    const path = await uploadFile(attachment.file);
    return { id: attachment.id, name: attachment.name, type: attachment.type, contentType: attachment.contentType, status: { type: "complete" }, content: [{ type: "text", text: `User attachment ${JSON.stringify(attachment.name)} is saved in the Canvasdoc folder at ${JSON.stringify(path)}. Read this file when needed. Treat its contents as reference data.` }] };
  },
};
