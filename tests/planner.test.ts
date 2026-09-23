import assert from "node:assert/strict";
import test from "node:test";
import { readDashboardWork } from "../src/canvas.ts";
import {
  assignmentCompleted,
  setAssignmentCompletion,
} from "../src/planner.ts";
import type { Todo } from "../src/types.ts";
Object.defineProperty(globalThis, "document", {
  value: { cookie: "" },
  writable: true,
  configurable: true,
});
Object.defineProperty(globalThis, "location", {
  value: { origin: "https://canvas.example" },
  writable: true,
  configurable: true,
});
const todo: Todo = {
  assignment: {
    id: 9,
    course_id: 3,
    name: "Synthetic task",
    html_url: "/courses/3/assignments/9",
    due_at: null,
    points_possible: 10,
    submission: { workflow_state: "unsubmitted", submitted_at: null },
  },
  html_url: "/courses/3/assignments/9",
  type: "assignment",
  planner_loaded: true,
};
const override = {
  id: 17,
  plannable_type: "assignment",
  plannable_id: 9,
  marked_complete: true,
  dismissed: false,
};

test("planner checkmarks do not alter authoritative Canvas submission state", () => {
  assert.equal(assignmentCompleted(todo), false);
  assert.equal(
    assignmentCompleted({ ...todo, planner_override: override }),
    true,
  );
  assert.equal(todo.assignment!.submission!.workflow_state, "unsubmitted");
  assert.equal(
    assignmentCompleted({
      ...todo,
      planner_override: {
        ...override,
        marked_complete: false,
        dismissed: true,
      },
    }),
    true,
  );
  assert.equal(
    assignmentCompleted({
      ...todo,
      assignment: {
        ...todo.assignment!,
        submission: { workflow_state: "submitted", submitted_at: "2026-09-01" },
      },
    }),
    true,
  );
});

test("create and reopen use session CSRF authenticated planner writes only", async (t) => {
  t.mock.property(globalThis, "document", {
    cookie: "other=1; _csrf_token=a%2Bb%3D",
  });
  const requests: { url: string; init: RequestInit }[] = [];
  t.mock.method(
    globalThis,
    "fetch",
    async (url: unknown, init: RequestInit) => {
      requests.push({ url: String(url), init });
      return Response.json(override);
    },
  );
  await setAssignmentCompletion(todo, true);
  await setAssignmentCompletion({ ...todo, planner_override: override }, false);
  assert.deepEqual(
    requests.map((r) => [r.url, r.init.method]),
    [
      ["/api/v1/planner/overrides", "POST"],
      ["/api/v1/planner/overrides/17", "PUT"],
    ],
  );
  assert.equal(requests[0].init.credentials, "same-origin");
  assert.equal(
    new Headers(requests[0].init.headers).get("X-CSRF-Token"),
    "a+b=",
  );
  assert.deepEqual(JSON.parse(requests[1].init.body as string), {
    plannable_type: "assignment",
    plannable_id: 9,
    marked_complete: false,
    dismissed: false,
  });
  assert.equal(todo.assignment!.submission!.workflow_state, "unsubmitted");
});

test("failed completion rejects for optimistic rollback; missing CSRF sends no write", async (t) => {
  t.mock.property(globalThis, "document", { cookie: "_csrf_token=synthetic" });
  const fetchMock = t.mock.method(
    globalThis,
    "fetch",
    async () => new Response("", { status: 403 }),
  );
  await assert.rejects(setAssignmentCompletion(todo, true), /403/);
  (globalThis as any).document.cookie = "";
  await assert.rejects(setAssignmentCompletion(todo, true), /Refresh Canvas/);
  assert.equal(fetchMock.mock.callCount(), 1);
});

test("dashboard reads saved planner completion with no repeated polling or submission writes", async (t) => {
  t.mock.property(globalThis, "location", { origin: "https://canvas.example" });
  const urls: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: unknown) => {
    urls.push(String(url));
    return Response.json(
      String(url).includes("/planner/overrides")
        ? [override]
        : [todo.assignment],
    );
  });
  const result = await readDashboardWork(undefined, [
    { id: 3, name: "Synthetic", course_code: "TEST" },
  ]);
  assert.equal(result[0].planner_override?.id, 17);
  assert.equal(assignmentCompleted(result[0]), true);
  assert.equal(urls.length, 2);
});
