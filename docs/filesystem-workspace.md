# Filesystem and expanded workspace direction

September 14, 2026. Product direction and proposed implementation; the Workspace UI remains deferred.

## Ownership

- Canvas: official assignments, dates, rubrics, grades, and submission records.
- Browser extension: complete page-thread conversations, personal tasks, drafts, UI preferences, and file associations. Reuse assistant-ui persistence over extension-owned storage. No SQLite application database.
- User's Canvasdoc folder: real source downloads, working files, and outputs shared by Claude and the file viewer.
- Claude Code: main execution session, context, tools, and its own persisted transcripts. These may live in Claude's native configuration directory; starting in Canvasdoc does not automatically move them into the project folder.

One main Claude agent always starts at the chosen Canvasdoc root. Assignment subdirectories organize work; they do not own separate main sessions.

## Folder setup

Ask the user to create or choose the folder during local connector setup. Record its resolved absolute path and a stable root ID in a small configuration file. The launcher always sets that working directory, even if invoked from another directory. The native setup flow knows the real path; a browser directory handle should not be treated as an absolute path for a CLI process.

If the folder moves, let the user locate it and verify its root ID. Never create an empty replacement silently. Use root-relative paths for browser file references so relocating the root does not break every link.

Suggested lazy-created organization:

```text
Canvasdoc/
  .canvasdoc/
    config.json
  courses/
    cs101-42/
      course-materials/
      assignments/
        calculator-314/
          sources/
          work/
          outputs/
  personal/
```

Names are for readability; Canvas account/course/assignment IDs provide identity. A title change must not create another folder. Bind to one Canvas account initially; namespace additional accounts if supported. Create only folders needed by actual work. The file viewer initially filters to files associated with the current thread, with an optional all-files tree.

## Thin filesystem bridge

The existing machine connector should expose authenticated, root-scoped list, stat, read/range-read, write, import, rename, and change-subscription operations. It can also reveal/open a file in the native application on its host. These operations do not require an inference request. Keep them within the selected root, account for symlink escapes, and protect connector metadata from ordinary file-viewer edits.

Watch the real files on the host. Claude, the Canvasdoc viewer, and external editors all operate on the same bytes. Notify the browser of changes and refresh affected previews. Re-scan after reconnect because filesystem watchers can miss events; they are notifications, not a durable history. Ignore temporary/build directories by default and request large files on demand.

If editing is added, use file revisions and conditional saves. When Claude or an external editor changes a file with unsaved browser edits, present a conflict instead of overwriting. Atomic saves and short write coordination belong in the file bridge. Do not build a second bidirectional filesystem-sync product.

The same bridge works when the selected Claude host is remote: the browser retrieves bytes from that host. A download creates an explicit local copy. A browser directory picker cannot directly grant access to a remote host's disk.

## Sources and outputs

Canvas source items retain their official IDs/URLs and fetch metadata. Download materials on demand when Claude needs local files. Keep source copies separate from editable work; refreshing a Canvas source must not overwrite user-created outputs. Expose sources and outputs as logical file lists in the UI without requiring users to manage the underlying folder layout.

Dragging a file into a thread imports it into that assignment's files and records the association. Generated artifacts show up in the thread and Outputs list, opening the same on-disk file. File selections or code ranges can be attached to a message as a path, revision, and range.

Start with text/code/Markdown, images, and PDF previews. Office files can be downloaded/opened in their native application; richer previews can be generated locally later. Sandbox HTML previews so generated content cannot access Canvas or connector credentials. Do not promise a full editable Office suite as part of a file viewer.

## Two layouts, one conversation

Assignment view preserves the actual Canvas page in the center and its conversation in the full sidebar.

Workspace view promotes that same conversation into the main work area. Initially show a spacious chat with a compact Sources/Outputs panel. Opening a file produces a resizable chat-and-viewer split, with file tabs, preview controls, and close/expand actions. Do not leave a duplicate conversation sidebar open. Closing the file returns space to the chat; returning to Assignment docks the same conversation back into the sidebar.

Preserve thread ID, composer draft, running work, pending approvals, selected file, and appropriate scroll state. The layout change must not start a new session or resend context. Canvas global/course navigation and the Assignment/Workspace switch remain the route back to official content.

## Browser filesystem alternatives

The File System Access API can grant browser access to a user-selected directory, with handles stored in IndexedDB and permissions checked on reuse. It is useful as an optional browser-only file-viewer mode, but adds permission lifecycle and browser-support constraints and cannot launch Claude or solve remote-disk access. Since the connector already exists, using it as the primary filesystem path is simpler.

OPFS is browser-private storage, not the ordinary folder Claude uses. It may cache thumbnails, previews, and offline bytes, but should not become the authoritative working filesystem.

Browser-owned history automatically exports recoverable JSON/JSONL snapshots into `.canvasdoc/` so extension removal does not destroy the only copy. This is a backup/export, not a second database or competing writer. The connector also needs a small durable spool of undelivered events if it promises to deliver agent output after the browser disconnects; acknowledge and trim it after browser persistence.

References: [Work interface](https://learn.chatgpt.com/docs/get-started-with-work), [File System Access permissions](https://developer.chrome.com/blog/persistent-permissions-for-the-file-system-access-api), [OPFS](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system). The supplied Codex/Work screenshots are the primary layout references.

Browser state remains the primary application store. Exports run asynchronously after browser commits, with debounce/coalescing, atomic writes, and reconnect retries. The UI never waits on an export or reads disk snapshots during ordinary thread navigation. Restoration is explicit and checks revisions.
