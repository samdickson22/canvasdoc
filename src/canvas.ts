import { canvasResponseError } from "./canvas-error.ts";
import type { PageContext, Assignment, Course, Todo, PlannerOverride } from "./types";

export async function canvasRead<T>(
  path: string,
  signal?: AbortSignal,
): Promise<T> {
  const url: URL = new URL(path, location.origin);
  if (url.origin !== location.origin || !url.pathname.startsWith("/api/v1/"))
    throw new Error("Invalid Canvas API path.");
  const response: Response = await fetch(url, {
    credentials: "same-origin",
    signal,
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw await canvasResponseError(response);
  return response.json();
}

export async function canvasPages<T>(
  path: string,
  signal?: AbortSignal,
): Promise<T[]> {
  const result: T[] = [];
  let next: string | null = path;
  const visited = new Set<string>();
  while (next) {
    const url: URL = new URL(next, location.origin);
    if (
      url.origin !== location.origin ||
      !url.pathname.startsWith("/api/v1/") ||
      visited.has(url.href)
    )
      throw new Error("Invalid Canvas pagination.");
    visited.add(url.href);
    const response: Response = await fetch(url, {
      credentials: "same-origin",
      signal,
      headers: { Accept: "application/json" },
    });
    if (!response.ok)
      throw await canvasResponseError(response);
    result.push(...(await response.json()));
    next =
      response.headers.get("Link")?.match(/<([^>]+)>;\s*rel="next"/)?.[1] ??
      null;
  }
  return result;
}

export const readCourses = (signal?: AbortSignal) =>
  canvasPages<Course>(
    "/api/v1/courses?enrollment_state=active&include[]=total_scores&per_page=100",
    signal,
  );
export async function readDashboardWork(
  signal?: AbortSignal,
  knownCourses?: Course[],
): Promise<Todo[]> {
  const courses = knownCourses ?? (await readCourses(signal));
  const overridesRequest = canvasPages<PlannerOverride>(
    "/api/v1/planner/overrides?per_page=100",
    signal,
  ).catch(() => null);
  const assignments = (
    await Promise.all(
      courses.map(async (course) => {
        const assignments = await canvasPages<Assignment>(
          `/api/v1/courses/${course.id}/assignments?include[]=submission&per_page=100`,
          signal,
        );
        return assignments.map((assignment) => ({
          assignment,
          context_name: course.name,
          context_short_name: course.course_code,
          html_url: assignment.html_url,
          type: "assignment",
        }));
      }),
    )
  ).flat();
  const overrides = await overridesRequest;
  return assignments.map((todo) => ({
    ...todo,
    planner_loaded: overrides !== null,
    planner_override:
      overrides?.find(
        (o) =>
          o.plannable_type === "assignment" &&
          o.plannable_id === todo.assignment.id,
      ) ?? null,
  }));
}
/** A graded quiz or discussion shares its assignment's thread no matter which Canvas page opened it. */
export async function resolveCoursework(context: PageContext, signal?: AbortSignal): Promise<PageContext> {
  if (context.kind !== "quiz" && context.kind !== "discussion") return context;
  const endpoint = context.kind === "quiz"
    ? `/api/v1/courses/${context.courseId}/quizzes/${context.quizId}`
    : `/api/v1/courses/${context.courseId}/discussion_topics/${context.discussionId}`;
  let detail: { assignment_id?: number | null; title?: string } | null = null;
  try { detail = await canvasRead(endpoint, signal); } catch { return context; }
  const title = typeof detail?.title === "string" && detail.title.trim() ? detail.title.trim() : context.title;
  const assignmentId = typeof detail?.assignment_id === "number" ? detail.assignment_id : undefined;
  if (assignmentId === undefined) return { ...context, title };
  return { ...context, title, kind: "assignment", assignmentId, threadId: `assignment:${context.courseId}:${assignmentId}` };
}
export const readAssignment = (
  course: number,
  assignment: number,
  signal?: AbortSignal,
) =>
  canvasRead<Assignment>(
    `/api/v1/courses/${course}/assignments/${assignment}?include[]=submission`,
    signal,
  );
