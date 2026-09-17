# Course material sync

Canvasdoc reads accessible course content using the student's existing Canvas browser session. It does not ask for a personal Canvas API token or pass browser cookies to the companion. BetterCampus's same-origin, session-authenticated request pattern informed this integration.

The browser owns `materialCatalog` alongside its other application data. It includes source IDs, titles, paths, content revisions, text documents, download URLs, and collection errors. The companion's receipt manifest is a transfer/recovery ledger, not the application's database.

## Collection

Normal Canvasdoc course/to-do/assignment reads populate the material response cache and trigger collection only when their data changes. There is no repeating polling timer. First discovery waits for those page reads, avoiding duplicate course and assignment requests. Reconnecting the companion transfers already indexed materials without refetching Canvas. Returning to a visible tab checks materials only if the last collection is older than thirty minutes. Manual refresh bypasses caches; sending chat never triggers or waits on indexing.

Per-endpoint response caches still limit requests during triggered collections: assignment lists five minutes; course lists, pages, files, modules, announcements, and discussion/quiz descriptions fifteen minutes; syllabus hourly. Repeated 403/404 endpoints back off for six hours. Inline module items avoid separate per-module requests. If Canvas stays idle without updating its data, changes are picked up on the next navigation, stale return-to-tab check, or manual refresh; this is not a push subscription.

Collected sources include course syllabus content, assignment descriptions/dates/submission state/rubrics, page bodies, module indexes, announcements, discussion opening posts, accessible quiz descriptions where the endpoint exists, and course files. Module items and links in rich text discover referenced files. Missing module pages are fetched explicitly. External websites and publisher tools remain links; quiz attempts, question banks, and discussion replies are not crawled.

Markdown documents preserve source URLs and reference local files. Existing page bodies are reused when Canvas's update timestamp is unchanged. Binary revisions use file metadata; text revisions use content hashes. Unchanged sources are not transferred again. A failed endpoint preserves the prior catalog entries and surfaces the failure rather than treating them as deleted.

## Local layout

```
Canvasdoc/
  courses/canvas.calpoly.edu--<account-hash>/CSC-3665--192020/
    materials/
      course.md
      index.md
      pages/Relational-Algebra--42.md
      modules/Week-2--18.md
      announcements/Lab-Update--73.md
      files/Lecture-02--5136669.pdf
    assignments/Lab-2--1717451/sources/assignment.md
  .canvasdoc/materials/<account-hash>.json
```

Names are readable in Finder and agent directory listings. IDs remain suffixes to disambiguate duplicate titles and track identity through renames. When a source path changes, sync removes its previous copy only if its hash still matches the last synced contents; edited copies and working files are preserved. The account hash separates institutions and users. Drafts belong in `work/` folders. Sync accepts only source-folder paths, rejects traversal and symlinks, verifies transfer hashes, and atomically commits files and receipts. Changed local source files are preserved with a conflict message. Removed or inaccessible remote sources remain on disk but are excluded from a successfully refreshed index; a warning in the index explains this. Sync never deletes student work.

## Transport and UI

The companion advertises material support. The browser transfers files in 384 KiB chunks, below native-message limits, with a 100 MiB per-file ceiling. Up to four materials download and transfer concurrently, matching the extension and companion limits. Progress counts completed materials; individual failures do not block the remaining queue. Retries skip receipts whose revisions and paths still match. Local file and receipt commits remain serialized to avoid lost manifest updates. Work occurs outside the agent-turn queue. Older companions still support chat and show an update notice for material downloads.

The extension worker downloads Canvas-authorized files when browser CORS would block a redirect. It resolves file URLs from Canvas metadata rather than accepting arbitrary remote URLs. The development loader uses ordinary browser fetch; cross-origin downloads without CORS may fail there even when an installed extension can fetch them. Other CDN/custom-domain permissions may need extending for a school's deployment.

Home, connection settings, and Workspace Sources show sync status, errors, and a retry action. Browser navigation and cached data never wait on the companion. Offline collection records pending work; reconnection compares the catalog with disk receipts. Material previews retain the viewer's separate 25 MiB file limit.

## Validation

For changes to this flow, select relevant checks from `tests/material-sync.test.ts`, `tests/materials.test.ts`, and `tests/assignment-context.test.ts`. These cover transfer recovery, source changes, local edit conflicts, account separation, and assignment context. A full-suite run is not required.

`node dev/materials-integration.mjs` signs into the synthetic development Canvas with a normal student session, collects courses, verifies assignment-file links, downloads and verifies bytes, and checks that a second unchanged pass produces no changed revisions. `--live` exercises the running development companion's WebSocket protocol and writes synthetic materials into its configured root. This script never reads production Canvas credentials.

The synthetic fixture script is `dev/material-fixtures.rb`; run through the development container after copying it to the mounted state directory. The development quiz endpoint currently returns 404 and is reported as unavailable rather than silently claimed as synced.

## Assignment context freshness

Chat reads a synchronous browser snapshot with the current assignment requirements and rubric, source URLs, a bounded source map, and endpoint coverage. It does not wait for collection or local files. Assignment page observations have their own response entry, so observing one assignment does not mark the entire assignment listing fresh. Assignment list refreshes remain independent of module revisions.

Each cached endpoint records `at` for its latest attempt and `successfulAt` for its latest successful read. Failures retain the previous value and successful timestamp, including transient failures. Permission/not-found failures keep the six-hour backoff; other material endpoint failures retry after thirty seconds when collection is triggered. Failed course discovery retains the previous catalog and retries on the next collection. `checkedAt` is a collection timestamp, not proof that every source was refreshed. Missing rubric data is reported as not returned by Canvas. Chat marks truncated descriptions and rubrics and directs the agent to the source. Submission state is a timestamped Canvas observation, never inferred from local files.
