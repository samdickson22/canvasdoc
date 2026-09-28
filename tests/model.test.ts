import test from "node:test";
import assert from "node:assert/strict";
import { dueGroup, newTask, pageContext, safeLink } from "../src/model.ts";

test("an assignment keeps one thread across title changes and submission fragments", () => {
  const first = pageContext("/courses/1/assignments/22", "", "Original title");
  const renamed = pageContext(
    "/courses/1/assignments/22/",
    "?module_item_id=7",
    "Updated title",
  );
  assert.equal(first.threadId, renamed.threadId);
  assert.notEqual(
    first.threadId,
    pageContext("/courses/2/assignments/22", "", "Same title").threadId,
  );
  assert.equal(
    pageContext("/courses/1/quizzes", "", "Quizzes").threadId,
    "page:/courses/1/quizzes",
  );
});

test("personal tasks have their own route without hijacking assignment URLs", () => {
  assert.equal(
    pageContext("/", "?canvasdoc-task=abc", "").threadId,
    "personal:abc",
  );
  assert.equal(
    pageContext("/courses/1/assignments/22", "?canvasdoc-task=abc", "").kind,
    "assignment",
  );
});

test("personal task routes retain the saved title and course for material context", () => {
  const task = newTask({ title: "Study", description: "", link: "", courseId: 1, dueAt: null });
  const context = pageContext("/", `?canvasdoc-task=${task.id}`, "Dashboard", [task]);
  assert.equal(context.title, task.title);
  assert.equal(context.courseId, task.courseId);
  assert.equal(context.threadId, `personal:${task.id}`);
});

test("due grouping follows the Canvas time zone near midnight and across DST", () => {
  const now = new Date("2026-09-15T06:30:00Z");
  assert.equal(
    dueGroup("2026-09-15T05:30:00Z", now, "America/Denver"),
    "Overdue",
  );
  assert.equal(
    dueGroup("2026-09-15T05:30:00Z", now, "America/Los_Angeles"),
    "Today",
  );
  assert.equal(
    dueGroup(
      "2026-03-09T06:30:00Z",
      new Date("2026-03-08T07:30:00Z"),
      "America/Denver",
    ),
    "Tomorrow",
  );
  assert.equal(dueGroup(null, now), "No due date");
});

test("linked resources reject script and local-file URLs", () => {
  assert.equal(safeLink("javascript:alert(1)", "https://canvas.example"), null);
  assert.equal(safeLink("file:///etc/passwd", "https://canvas.example"), null);
  assert.equal(
    safeLink("/courses/1", "https://canvas.example"),
    "https://canvas.example/courses/1",
  );
});

test("personal tasks validate dates and keep official Canvas fields out of their record", () => {
  assert.throws(() =>
    newTask({
      title: " ",
      description: "",
      link: "",
      courseId: null,
      dueAt: null,
    }),
  );
  assert.throws(() =>
    newTask({
      title: "Study",
      description: "",
      link: "",
      courseId: null,
      dueAt: "bad",
    }),
  );
  const task = newTask({
    title: " Study ",
    description: "",
    link: "",
    courseId: 1,
    dueAt: null,
  });
  assert.equal(task.title, "Study");
  assert.equal(task.completed, false);
  assert.equal("submission" in task, false);
});

test("quiz and discussion pages get their own stable threads before resolution", async () => {
  const { isCoursework, courseworkLabel } = await import("../src/model.ts");
  const quiz = pageContext("/courses/3/quizzes/44", "", "Week 2 quiz");
  assert.equal(quiz.kind, "quiz");
  assert.equal(quiz.threadId, "quiz:3:44");
  assert.equal(quiz.quizId, 44);
  assert.equal(pageContext("/courses/3/quizzes/44/take", "?preview=1", "Taking").threadId, "quiz:3:44");
  assert.equal(quiz.href, "/courses/3/quizzes/44");
  const discussion = pageContext("/courses/3/discussion_topics/9/", "", "Intro post");
  assert.equal(discussion.kind, "discussion");
  assert.equal(discussion.threadId, "discussion:3:9");
  assert.equal(discussion.discussionId, 9);
  assert.equal(pageContext("/courses/3/discussion_topics", "", "Discussions").kind, "page");
  assert.ok(isCoursework("quiz") && isCoursework("discussion") && isCoursework("assignment") && !isCoursework("page"));
  assert.equal(courseworkLabel("discussion"), "Discussion");
});
