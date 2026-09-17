import test from "node:test";
import assert from "node:assert/strict";
import type { PendingAttachment } from "@assistant-ui/react";
import { createAttachmentAdapter, attachmentWorkspaceHref, type AttachmentUploadState } from "../src/runtime/attachments.ts";

const attachment = (): PendingAttachment => ({
  id: "upload-1", name: "notes #1.pdf", type: "document", contentType: "application/pdf",
  file: new File(["notes"], "notes #1.pdf", { type: "application/pdf" }),
  status: { type: "requires-action", reason: "composer-send" },
});

test("upload failure reports an actionable error before rejecting, and retry succeeds", async () => {
  const states: AttachmentUploadState[] = [];
  const errors: string[] = [];
  let fail = true;
  const adapter = createAttachmentAdapter({
    upload: async () => {
      if (fail) throw new Error("Computer disconnected");
      return "uploads/notes #1.pdf";
    },
    onError: message => errors.push(message),
    onUploadState: (id, state) => { assert.equal(id, "upload-1"); states.push(state); },
  });
  await assert.rejects(adapter.send(attachment()), /Computer disconnected/);
  assert.deepEqual(states.map(s => s.type), ["uploading", "error"]);
  assert.match(errors[0], /notes #1.pdf.*Computer disconnected.*Try sending again/);
  fail = false;
  const sent = await adapter.send(attachment());
  assert.deepEqual(states.map(s => s.type), ["uploading", "error", "uploading", "complete"]);
  assert.equal(sent.status.type, "complete");
  assert.equal(attachmentWorkspaceHref(sent), "uploads/notes%20%231.pdf");
  assert.equal(sent.file, undefined, "Browser File objects are not persisted");
});

test("historical sent attachments open only valid workspace paths", () => {
  const reference = (path: string) => ({ content: [{ type: "text" as const, text: `User attachment "notes" is saved in the Canvasdoc folder at ${JSON.stringify(path)}. Read this file when needed.` }] });
  assert.equal(attachmentWorkspaceHref(reference("uploads/a%20b.pdf")), "uploads/a%2520b.pdf");
  for (const unsafe of ["../secret", "/etc/passwd", "https://example.com/file", "uploads/.hidden", "uploads/a\\b"])
    assert.equal(attachmentWorkspaceHref(reference(unsafe)), undefined, unsafe);
  assert.equal(attachmentWorkspaceHref({content: [{type:"text", text:'saved in the Canvasdoc folder at "bad\\q".'}]}), undefined);
});
