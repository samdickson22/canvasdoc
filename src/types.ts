export type Course = { id: number; name: string; course_code: string };
export type Assignment = {
  id: number;
  course_id: number;
  name: string;
  html_url: string;
  due_at: string | null;
  points_possible: number | null;
  description?: string;
  submission?: { workflow_state: string; submitted_at: string | null };
};
export type Todo = {
  assignment?: Assignment;
  context_name?: string;
  context_short_name?: string;
  html_url: string;
  type: string;
};
export type PersonalTask = {
  id: string;
  title: string;
  description: string;
  link: string;
  courseId: number | null;
  dueAt: string | null;
  completed: boolean;
  createdAt: string;
};
export type SavedMessage = {
  attachments?: import("@assistant-ui/react").CompleteAttachment[];
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: string;
};
export type ThreadRecord = {
  id: string;
  title: string;
  href: string;
  draft: string;
  messages: SavedMessage[];
  updatedAt: string;
};
export type PageContext = {
  threadId: string;
  title: string;
  href: string;
  kind: "home" | "assignment" | "page" | "personal";
  courseId?: number;
  assignmentId?: number;
  taskId?: string;
};
