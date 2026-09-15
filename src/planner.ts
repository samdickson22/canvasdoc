import { canvasPages } from "./canvas.ts";
import type { PlannerOverride, Todo } from "./types.ts";

export function assignmentCompleted(todo: Todo): boolean {
  // Completion in the student's planner does not change submission status.
  return Boolean(
    todo.planner_override?.marked_complete ||
    todo.planner_override?.dismissed ||
    ["submitted", "graded", "pending_review"].includes(
      todo.assignment?.submission?.workflow_state ?? "",
    ),
  );
}

export async function setAssignmentCompletion(
  todo: Todo,
  complete: boolean,
): Promise<PlannerOverride> {
  if (!todo.assignment) throw new Error("This task has no Canvas assignment.");
  let override = todo.planner_override;
  if (!todo.planner_loaded) {
    const overrides = await canvasPages<PlannerOverride>(
      "/api/v1/planner/overrides?per_page=100",
    );
    override = overrides.find(
      (o) =>
        o.plannable_type === "assignment" &&
        o.plannable_id === todo.assignment!.id,
    );
  }
  const rawToken = document.cookie
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith("_csrf_token="))
    ?.slice(12);
  if (!rawToken)
    throw new Error("Refresh Canvas and try marking this task again.");
  const response = await fetch(
    `/api/v1/planner/overrides${override ? `/${override.id}` : ""}`,
    {
      method: override ? "PUT" : "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-CSRF-Token": decodeURIComponent(rawToken),
      },
      body: JSON.stringify({
        plannable_type: "assignment",
        plannable_id: todo.assignment.id,
        marked_complete: complete,
        dismissed: complete ? (override?.dismissed ?? false) : false,
      }),
    },
  );
  if (!response.ok)
    throw new Error(
      `Canvas could not ${complete ? "complete" : "reopen"} this to-do (${response.status}). Try again.`,
    );
  return response.json();
}
