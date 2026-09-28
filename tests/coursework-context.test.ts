import test from "node:test";
import assert from "node:assert/strict";
import { materialSourceContext } from "../src/runtime/chat-context.ts";
import { usageSummary } from "../src/runtime/plan.ts";

test("quiz and discussion briefings come from collected listings and pick their own sources", () => {
  const catalog: any = {
    resources: [
      { id: "1:quiz:44", courseId: 1, title: "Week 2 quiz", path: "courses/c/materials/quizzes/Week-2--44.md", sourceUrl: "https://canvas.invalid/courses/1/quizzes/44" },
      { id: "1:discussion:9", courseId: 1, title: "Intro post", path: "courses/c/materials/discussions/Intro--9.md", sourceUrl: "https://canvas.invalid/courses/1/discussion_topics/9" },
      { id: "1:file:77", courseId: 1, title: "Reading.pdf", path: "courses/c/materials/files/Reading--77.pdf", sourceUrl: "https://canvas.invalid/files/77" },
      { id: "1:course", courseId: 1, title: "Course", path: "courses/c/materials/course.md", sourceUrl: "https://canvas.invalid/courses/1" },
    ],
    responses: {
      "/api/v1/courses/1/quizzes?per_page=100": { at: 5, successfulAt: 5, value: [
        { id: 44, title: "Week 2 quiz", html_url: "https://canvas.invalid/courses/1/quizzes/44", description: "<p>Covers chapters 1-2. See <a href=\"/files/77/download\">reading</a>.</p>", due_at: "2026-10-01T06:59:00Z", points_possible: 20, time_limit: 30, allowed_attempts: 2, question_count: 10, quiz_type: "assignment" },
      ] },
      "/api/v1/courses/1/discussion_topics?per_page=100": { at: 6, successfulAt: 6, value: [
        { id: 9, title: "Intro post", html_url: "https://canvas.invalid/courses/1/discussion_topics/9", message: "<p>Introduce yourself.</p>", require_initial_post: true, discussion_type: "threaded", todo_date: "2026-09-30T00:00:00Z" },
      ] },
    },
  };
  const quiz = JSON.parse(materialSourceContext(catalog, { courseId: 1, quizId: 44 }));
  assert.equal(quiz.quiz.points, 20);
  assert.equal(quiz.quiz.timeLimitMinutes, 30);
  assert.equal(quiz.quiz.questionCount, 10);
  assert.match(quiz.quiz.descriptionHtml, /chapters 1-2/);
  assert.equal(quiz.quiz.descriptionCoverage, "returned");
  assert.equal(quiz.assignment, undefined);
  assert.deepEqual(quiz.sources.slice(0, 3).map((s: any) => s.title).sort(), ["Course", "Reading.pdf", "Week 2 quiz"]);
  assert.equal(quiz.sources[0].title, "Week 2 quiz");
  const discussion = JSON.parse(materialSourceContext(catalog, { courseId: 1, discussionId: 9 }));
  assert.match(discussion.discussion.promptHtml, /Introduce yourself/);
  assert.equal(discussion.discussion.requireInitialPost, true);
  assert.equal(discussion.discussion.graded, false);
  assert.equal(discussion.discussion.dueAt, "2026-09-30T00:00:00Z");
  assert.equal(discussion.sources[0].title, "Intro post");
  const missing = JSON.parse(materialSourceContext(catalog, { courseId: 1, quizId: 999 }));
  assert.match(missing.quiz.coverage, /not been collected/);
  assert.equal(JSON.parse(materialSourceContext(catalog, { courseId: 1, assignmentId: 2 })).quiz, undefined);
});

test("graded quizzes and discussions resolve to their assignment thread; failures keep the page thread", async (t) => {
  (globalThis as any).location = { origin: "https://canvas.invalid" };
  const responses: Record<string, any> = {
    "/api/v1/courses/1/quizzes/44": { id: 44, title: "Week 2 quiz", assignment_id: 300 },
    "/api/v1/courses/1/discussion_topics/9": { id: 9, title: "Intro post", assignment_id: null },
  };
  t.mock.method(globalThis, "fetch", async (input: any) => {
    const url = new URL(String(input));
    const body = responses[url.pathname];
    return body ? Response.json(body) : Response.json({ message: "nope" }, { status: 403 });
  });
  const { resolveCoursework } = await import("../src/canvas.ts");
  const { pageContext } = await import("../src/model.ts");
  const graded = await resolveCoursework(pageContext("/courses/1/quizzes/44", "", "Week 2 quiz"));
  assert.equal(graded.kind, "assignment");
  assert.equal(graded.threadId, "assignment:1:300");
  assert.equal(graded.assignmentId, 300);
  assert.equal(graded.quizId, 44);
  const ungraded = await resolveCoursework(pageContext("/courses/1/discussion_topics/9", "", "Intro"));
  assert.equal(ungraded.kind, "discussion");
  assert.equal(ungraded.threadId, "discussion:1:9");
  assert.equal(ungraded.title, "Intro post");
  const unreachable = await resolveCoursework(pageContext("/courses/1/quizzes/45", "", "Locked quiz"));
  assert.equal(unreachable.threadId, "quiz:1:45");
  assert.equal((await resolveCoursework(pageContext("/courses/1/assignments/2", "", "A"))).threadId, "assignment:1:2");
});

test("usage summary reads the plan windows and warns near the limit", () => {
  const now = Date.parse("2026-09-28T12:00:00Z");
  assert.equal(usageSummary(undefined), undefined);
  const light = usageSummary({ primary: { usedPercent: 12, resetsAt: now / 1000 + 2 * 3600 + 600, windowMinutes: 300 } }, now)!;
  assert.equal(light.text, "12% of 5h");
  assert.match(light.detail, /resets in 2h 10m/);
  assert.equal(light.warning, false);
  const heavy = usageSummary({ primary: { usedPercent: 100, resetsAt: now / 1000 + 90, windowMinutes: 300 }, secondary: { usedPercent: 63, resetsAt: now / 1000 + 5 * 86400, windowMinutes: 10080 } }, now)!;
  assert.equal(heavy.text, "100% of 5h · 63% of week");
  assert.match(heavy.detail, /resets in 2m/);
  assert.equal(heavy.warning, true);
  assert.equal(usageSummary({ secondary: { usedPercent: 140.4, windowMinutes: 1440 } }, now)!.text, "100% of day");
});
