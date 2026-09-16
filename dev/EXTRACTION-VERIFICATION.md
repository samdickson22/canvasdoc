# Extraction verification — 0.1.10

`npm run check`: typecheck, extension build, and 56 tests passed.

New extraction coverage:
- Real PDF parsing with multiple pages, Latin Unicode, blank/mixed pages, and corrupt input.
- PPTX ZIP/XML parsing with presentation order different from slide filenames, Unicode, speaker notes, invalid ZIPs, and rejected document-type/entity declarations.
- Download-to-sidecar integration through MaterialMirror without modifying original bytes.
- Checksum reuse and source updates.
- Restart recovery from pending jobs and a crash between output rename and final ledger commit.
- Recovery of missing sidecars through persisted material receipts.
- Preservation of user edits, path containment, and symlink rejection.

Packaging checks found and fixed a duplicate `createRequire` declaration in the extraction worker. Packaging now runs Node syntax checks on all three bundled executables. Installed the actual CLI tarball into a fresh temporary prefix, outside the repository; both PDF and PPTX extraction succeeded using that installation and its declared dependencies. The reconnect/restart test also passed against the bundled connector entrypoint.

Synthetic PDFs/PPTX were committed through the actual MaterialMirror into the separate preview workspace. Ready, needs-OCR, and error sidecars were generated. The T3 preview client disconnected while opening both localhost and the private dev URL; browser rendering of these new sidecars is therefore not verified in this pass. Existing file-preview checks are recorded separately in WORKSPACE-RELEASE-VERIFICATION.md.

No production Canvas writes, OCR, model-based extraction, or publishing occurred.
