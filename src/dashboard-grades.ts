import type { Course } from "./types";

export function courseGrade(course?: Course): string {
  const enrollment = course?.enrollments?.find(value => value.type === "student");
  const score = enrollment?.computed_current_score;
  const letter = enrollment?.computed_current_grade ?? enrollment?.computed_current_letter_grade;
  const percentage = typeof score === "number" && Number.isFinite(score)
    ? `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(score)}%`
    : null;
  return [letter, percentage].filter(Boolean).join(" · ") || "Not available";
}

// Canvas mounts and reorders its own cards asynchronously. Only decorate them.
export function showDashboardGrades(root: HTMLElement, courses: Course[]) {
  const update = () => {
    for (const card of root.querySelectorAll<HTMLElement>(".ic-DashboardCard")) {
      const link = card.querySelector<HTMLAnchorElement>("a.ic-DashboardCard__link");
      const id = link?.pathname.match(/^\/courses\/(\d+)(?:\/|$)/)?.[1];
      if (!id || !link) continue;
      const label = `Current grade: ${courseGrade(courses.find(course => course.id === Number(id)))}`;
      let grade = card.querySelector<HTMLAnchorElement>(".canvasdoc-course-grade");
      if (!grade) {
        grade = document.createElement("a");
        grade.className = "canvasdoc-course-grade";
        link.after(grade);
      }
      grade.href = `/courses/${id}/grades`;
      if (grade.textContent !== label) grade.textContent = label;
    }
  };
  const observer = new MutationObserver(update);
  update();
  observer.observe(root, { childList: true, subtree: true });
  return () => {
    observer.disconnect();
    root.querySelectorAll(".canvasdoc-course-grade").forEach(element => element.remove());
  };
}
