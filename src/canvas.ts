import type { Assignment, Course, Todo } from "./types";

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
  if (!response.ok)
    throw new Error(
      response.status === 401
        ? "Sign in to Canvas to load your work."
        : `Canvas could not load this data (${response.status}).`,
    );
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
      throw new Error(`Canvas could not load your work (${response.status}).`);
    result.push(...(await response.json()));
    next =
      response.headers.get("Link")?.match(/<([^>]+)>;\s*rel="next"/)?.[1] ??
      null;
  }
  return result;
}

export const readCourses = (signal?: AbortSignal) =>
  canvasPages<Course>(
    "/api/v1/courses?enrollment_state=active&per_page=100",
    signal,
  );
export const readTodos = (signal?: AbortSignal) =>
  canvasPages<Todo>("/api/v1/users/self/todo?per_page=100", signal);
export async function readDashboardWork(signal?: AbortSignal, knownCourses?: Course[]): Promise<Todo[]> {
  const courses = knownCourses ?? await readCourses(signal);
  return (await Promise.all(courses.map(async course => {
    const assignments = await canvasPages<Assignment>(`/api/v1/courses/${course.id}/assignments?include[]=submission&per_page=100`, signal);
    return assignments.map(assignment => ({ assignment, context_name: course.name, context_short_name: course.course_code, html_url: assignment.html_url, type: "assignment" }));
  }))).flat();
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
