Radial geometry helpers adapted from UseBetterCanvas/canvas-task-extension, MIT copyright2020 Jeffrey Cheng. See LICENSE. The Canvasdoc course-filter wheel adapts that project's concentric progress-ring interaction to the semicircle shown in BetterCampus. Task and navigation markup is implemented for Canvasdoc's data model.

To-do completion follows the Canvas planner override approach used by
[`markAssignment.ts`](https://github.com/UseBetterCanvas/canvas-task-extension/blob/main/src/pages/Content/modules/plugins/canvas/utils/markAssignment.ts)
and its session-CSRF `apiReq.ts` helper. Canvasdoc's implementation lives in
`src/planner.ts`: it waits for the API result, rolls back failed optimistic
changes, and keeps submission state separate. Saved overrides are read once
with the normal dashboard refresh, without a new polling timer.
