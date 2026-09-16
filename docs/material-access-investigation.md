# Material access investigation — 2026-09-15

Read-only investigation; no collection behavior changed. Production requests were not replayed in this pass. Findings below explain possible causes of the previously reported 403/404 responses, not confirmed causes for every affected course.

## Confirmed implementation behavior

- Canvasdoc extracts file IDs from links but discards the linked context and lookup parameters, then requests `/api/v1/courses/<current-course>/files/<id>`.
- Canvas's `FilesController#api_show` searches the current context's attachments when a context is supplied. A linked file outside that course therefore returns 404 even if the user can access it through another context. Canvas also supports `/api/v1/files/<id>`; this remains subject to access checks, not a permissions bypass.
- Canvas's `FilesController#api_index` requires `read_contents` on the folder. Listing access and individual-file access are distinct. A 403 on the collection alone does not establish that every linked file is inaccessible.
- Canvas's Pages and Quizzes index controllers check whether the corresponding course tab is enabled. A denied/hidden index is not enough evidence to conclude there are no materials. Module-linked pages already have a separate lookup path in Canvasdoc.
- Existing Canvasdoc logic preserves previous data on collection errors and caches 403/404 responses for six hours unless manually refreshed. This can prolong a stale failure after permissions change.
- External assignment sites are retained as links rather than collected. This is a separate coverage gap from Canvas API errors.

## Evidence inspected

- `src/material-collector.ts`: link extraction, endpoint selection, module fallback, error cache.
- Self-hosted upstream Canvas source: `app/controllers/files_controller.rb` (`api_index`, `api_show`), `app/controllers/wiki_pages_controller.rb` (`index`), `app/controllers/quizzes/quizzes_api_controller.rb` (`index`).
- Official file API documentation: https://developerdocs.instructure.com/services/canvas/resources/files

## Proposed next investigation, requiring a later decision

Compare a small sample of the reported failures against the exact link in Canvas, its original context/parameters, course tab availability, and the context-free file metadata endpoint. Classify unavailable, permission-denied, stale/deleted, and wrong-context cases separately. Do not change permissions, collect quiz attempts, or bulk retry the entire course catalog to diagnose a few failures.

No API-token requirement has been established by these errors.
