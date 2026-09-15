# First UI slice verification

Verified September 14, 2026 against the self-hosted Canvas using the T3 in-app browser and the synthetic student account. Production Canvas was not opened or modified.

## Completed

- Real dashboard API reads returned the synthetic assignments. Displayed dates follow the student's Canvas time zone, America/Denver, rather than the browser's local time zone.
- Clicking the calculator to-do navigated to `/courses/1/assignments/1`.
- The original Canvas assignment content remained visible in the center. Canvasdoc showed exactly one full-height conversation sidebar, with no other to-dos inside it.
- Workspace hid the original center content and showed the deferred placeholder. Assignment restored the original elements. The sidebar draft stayed intact.
- Canvas's Start Assignment control opened its native submission form. The test cancelled that form without submitting.
- A message draft was entered, saved, and restored after a full page reload. It also survived collapsing and reopening the sidebar.
- A personal task was created through the task dialog, opened through its own URL, and marked complete. These changes were stored only in Canvasdoc's browser data.
- The assignment and Workspace layouts were visually inspected through T3 screenshots at 1280 x 800. The assignment page had no horizontal overflow.
- `npm run typecheck`, `npm test` with eight passing checks, and `npm run build` passed.

## Issues found and addressed

- Canvas overrides `Date.parse`, returning null for the saved ISO timestamps. Validation now uses the Date constructor and `getTime`; a regression test reproduces Canvas's override.
- The initial development bundle triggered React's production dead-code-elimination warning. Both build modes now minify the production React bundle.
- Canvas uses a configured student time zone that can differ from the browser. Due-date formatting and grouping now use the profile's time zone.

## Limits

The T3 typing helper rejects a shadow-root input because it compares the focused input to `document.activeElement`, which is the shadow host. Text entry was exercised through T3 evaluation with focus, selection, and `document.execCommand('insertText')`. T3 clicks were used for controls; coordinate clicks verified sidebar collapse and reopen. T3 screenshots intermittently failed, and the preview API continued to report the panel as hidden despite requests to show it.

Agent execution, machine pairing, remote persistence, extension installation, the rich-content service's full submission path, and production Canvas have not been verified. This is the first UI slice, not a completed agent integration.
