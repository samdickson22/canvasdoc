import type { PageContext, PersonalTask } from "./types.ts";

// The account/origin namespace is applied by the store. Assignment IDs never depend on titles.
export function pageContext(
  pathname: string,
  search: string,
  title: string,
  tasks: PersonalTask[] = [],
): PageContext {
  const taskId = new URLSearchParams(search).get("canvasdoc-task");
  if (pathname === "/" && taskId) {
    const task = tasks.find(item => item.id === taskId);
    return {
      kind: "personal",
      threadId: `personal:${taskId}`,
      taskId,
      title: task?.title ?? "Personal task",
      courseId: task?.courseId ?? undefined,
      href: `/?canvasdoc-task=${encodeURIComponent(taskId)}`,
    };
  }
  const assignment = pathname.match(
    /^\/courses\/(\d+)\/assignments\/(\d+)\/?$/,
  );
  if (assignment)
    return {
      kind: "assignment",
      threadId: `assignment:${assignment[1]}:${assignment[2]}`,
      courseId: Number(assignment[1]),
      assignmentId: Number(assignment[2]),
      title,
      href: pathname,
    };
  // Graded quizzes and discussions are also assignments; resolveCoursework re-keys them to the assignment thread.
  const quiz = pathname.match(/^\/courses\/(\d+)\/quizzes\/(\d+)(?:\/(?:take|history|statistics))?\/?$/);
  if (quiz)
    return {
      kind: "quiz",
      threadId: `quiz:${quiz[1]}:${quiz[2]}`,
      courseId: Number(quiz[1]),
      quizId: Number(quiz[2]),
      title,
      href: `/courses/${quiz[1]}/quizzes/${quiz[2]}`,
    };
  const discussion = pathname.match(/^\/courses\/(\d+)\/discussion_topics\/(\d+)\/?$/);
  if (discussion)
    return {
      kind: "discussion",
      threadId: `discussion:${discussion[1]}:${discussion[2]}`,
      courseId: Number(discussion[1]),
      discussionId: Number(discussion[2]),
      title,
      href: `/courses/${discussion[1]}/discussion_topics/${discussion[2]}`,
    };
  if (pathname === "/" || pathname === "/dashboard")
    return { kind: "home", threadId: "home", title: "Dashboard", href: "/" };
  const course = pathname.match(/^\/courses\/(\d+)/);
  return {
    kind: "page",
    threadId: `page:${pathname.replace(/\/$/, "")}`,
    courseId: course ? Number(course[1]) : undefined,
    title,
    href: pathname,
  };
}

/** Pages that get the assignment treatment: the real Canvas page with the attached conversation and workspace. */
export const isCoursework = (kind: PageContext["kind"]) => kind === "assignment" || kind === "quiz" || kind === "discussion";
export const courseworkLabel = (kind: PageContext["kind"]) => kind === "quiz" ? "Quiz" : kind === "discussion" ? "Discussion" : "Assignment";

export function safeLink(value: string, origin: string): string | null {
  try {
    const u = new URL(value, origin);
    return ["http:", "https:"].includes(u.protocol) ? u.href : null;
  } catch {
    return null;
  }
}

export function dueGroup(
  value: string | null,
  now = new Date(),
  timeZone?: string,
): string {
  if (!value) return "No due date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No due date";
  const calendarDay = (value: Date) => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "numeric",
      day: "numeric",
    }).formatToParts(value);
    const part = (name: string) =>
      Number(parts.find((p) => p.type === name)!.value);
    return new Date(Date.UTC(part("year"), part("month") - 1, part("day")));
  };
  const today = calendarDay(now);
  const day = calendarDay(date);
  if (day < today) return "Overdue";
  if (+day === +today) return "Today";
  const tomorrow = new Date(today);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  if (+day === +tomorrow) return "Tomorrow";
  const nextWeek = new Date(today);
  nextWeek.setUTCDate(nextWeek.getUTCDate() + 7);
  return day < nextWeek ? "Next 7 days" : "Later";
}

export function newTask(
  input: Pick<
    PersonalTask,
    "title" | "description" | "link" | "courseId" | "dueAt"
  >,
): PersonalTask {
  if (!input.title.trim()) throw new Error("Give your task a title.");
  if (input.dueAt && Number.isNaN(new Date(input.dueAt).getTime()))
    throw new Error("Choose a valid due date.");
  return {
    ...input,
    title: input.title.trim(),
    id: crypto.randomUUID(),
    completed: false,
    createdAt: new Date().toISOString(),
  };
}
