import TurndownService from "turndown";
import { CanvasAccessError } from "./canvas-error.ts";
import { canvasPages, canvasRead, readCourses } from "./canvas.ts";
import { courseFolder, resourceName } from "./material-layout.ts";
import type { Material, MaterialCatalog } from "./material-types.ts";
import type { Course } from "./types.ts";

const markdown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
});
export function safeFilename(name: string): string {
  return (
    name
      .replace(/[\\/\x00-\x1f:*?"<>|]/g, "-")
      .replace(/^\.+/, "")
      .slice(0, 150) || "file"
  );
}
export async function sha256(value: string | Uint8Array): Promise<string> {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        typeof value === "string"
          ? new TextEncoder().encode(value)
          : new Uint8Array(value),
      ),
    ),
  )
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}

export async function collectMaterials(
  signal: AbortSignal,
  previous?: MaterialCatalog,
  onlyCourse?: number,
  force = false,
): Promise<MaterialCatalog> {
  const responses = { ...previous?.responses };
  const resources = new Map<string, Material>();
  const errors: string[] = [];
  const notices: string[] = onlyCourse ? [...(previous?.notices ?? [])] : [];
  const prior = new Map(previous?.resources.map((r) => [r.id, r]));
  if (onlyCourse)
    for (const resource of previous?.resources ?? [])
      if (resource.courseId !== onlyCourse)
        resources.set(resource.id, resource);
  async function single(endpoint: string, ttl: number): Promise<any> {
    const cached = responses[endpoint];
    if (
      !force &&
      cached &&
      Date.now() - cached.at < (cached.error ? 6 * 60 * 60 * 1000 : ttl)
    ) {
      if (cached.error) throw new Error(cached.error);
      return cached.value[0];
    }
    try {
      const value = await canvasRead<any>(endpoint, signal);
      responses[endpoint] = { at: Date.now(), value: [value] };
      return value;
    } catch (error) {
      signal.throwIfAborted();
      const message = (error as Error).message;
      if (/\((403|404)\)/.test(message))
        responses[endpoint] = { at: Date.now(), value: [], error: message };
      throw error;
    }
  }
  const courseKey = "active-courses";
  let knownCourses = responses[courseKey]?.value as Course[] | undefined;
  if (
    !knownCourses ||
    force ||
    Date.now() - responses[courseKey].at > 15 * 60 * 1000
  ) {
    knownCourses = await readCourses(signal);
    responses[courseKey] = { at: Date.now(), value: knownCourses };
  }
  const courses = onlyCourse
    ? [
        knownCourses.find((course) => course.id === onlyCourse) ||
          (await single(`/api/v1/courses/${onlyCourse}`, 60 * 60 * 1000)),
      ]
    : knownCourses;
  for (const course of courses) {
    signal.throwIfAborted();
    if (onlyCourse)
      for (let i = notices.length - 1; i >= 0; i--)
        if (notices[i].startsWith(`${course.name}:`)) notices.splice(i, 1);
    const base = `/api/v1/courses/${course.id}`;
    const folder = courseFolder(course.id, course.course_code || course.name);
    const fileIds = new Set<number>();
    const fileLinks = new Map<number, string>();
    const documents: {
      id: string;
      path: string;
      title: string;
      url: string;
      html: string;
      extra?: string;
    }[] = [];
    const failed = new Set<string>();
    async function list(endpoint: string, category: string): Promise<any[]> {
      const cached = responses[endpoint];
      let ttl = 15 * 60 * 1000;
      if (cached?.error) ttl = 6 * 60 * 60 * 1000;
      else if (category === "assignment") ttl = 5 * 60 * 1000;
      if (!force && cached && Date.now() - cached.at < ttl) {
        if (cached.error) {
          failed.add(category);
          (cached.notice ? notices : errors).push(
            `${course.name}: ${category}: ${cached.error}`,
          );
        }
        return cached.value;
      }
      try {
        const value = await canvasPages<any>(endpoint, signal);
        responses[endpoint] = { at: Date.now(), value };
        return value;
      } catch (error) {
        signal.throwIfAborted();
        const message = (error as Error).message;
        const notice =
          error instanceof CanvasAccessError &&
          (error.unavailable || (category === "file" && error.status === 403));
        if (/\((403|404)\)/.test(message))
          responses[endpoint] = {
            at: Date.now(),
            value: cached?.value || [],
            error: message,
            notice,
          };
        failed.add(category);
        (notice ? notices : errors).push(
          `${course.name}: ${category}: ${category === "file" && notice ? "Canvas does not allow listing this folder. Linked files are checked separately." : message}`,
        );
        return cached?.value || [];
      }
    }
    const addDocument = (
      id: string,
      relative: string,
      title: string,
      url: string,
      html: string,
      extra = "",
    ) => {
      documents.push({
        id: `${course.id}:${id}`,
        path: `${folder}/${relative}`,
        title,
        url,
        html: html || "",
        extra,
      });
      const doc = new DOMParser().parseFromString(html || "", "text/html");
      for (const node of doc.querySelectorAll("[href],[src]")) {
        const raw = node.getAttribute("href") || node.getAttribute("src") || "";
        try {
          const link = new URL(raw, url);
          const match = link.pathname.match(/\/files\/(\d+)/);
          if (link.origin === location.origin && match) {
            fileIds.add(Number(match[1]));
            fileLinks.set(Number(match[1]), link.href);
          }
        } catch {}
      }
    };
    try {
      const detail = await single(
        `${base}?include[]=syllabus_body`,
        60 * 60 * 1000,
      );
      addDocument(
        "course",
        "materials/course.md",
        course.name,
        `${location.origin}/courses/${course.id}`,
        detail.syllabus_body || "",
        `Course code: ${course.course_code}\n\nCanvas is authoritative. These are downloaded reference materials. Put drafts in work/ folders; do not edit synced sources.`,
      );
    } catch (error) {
      signal.throwIfAborted();
      failed.add("course");
      errors.push(`${course.name}: syllabus: ${(error as Error).message}`);
    }
    const assignments = await list(
      `${base}/assignments?include[]=submission&per_page=100`,
      "assignment",
    );
    for (const a of assignments) {
      if (a.locked_for_user) continue;
      addDocument(
        `assignment:${a.id}`,
        `assignments/${resourceName(a.id, a.name)}/sources/assignment.md`,
        a.name,
        a.html_url,
        a.description,
        `Due: ${a.due_at || "No due date"}\n\nPoints: ${a.points_possible ?? "None"}\n\nSubmission state: ${a.submission?.workflow_state || "unknown"}\n\nRubric:\n${a.rubric ? JSON.stringify(a.rubric, null, 2) : "None provided"}`,
      );
    }
    const pages = await list(`${base}/pages?per_page=100`, "page");
    for (const page of pages) {
      if (page.locked_for_user || page.published === false) continue;
      const id = `${course.id}:page:${page.page_id}`;
      const old = prior.get(id);
      if (
        old &&
        old.path ===
          `${folder}/materials/pages/${resourceName(page.page_id, page.title)}.md` &&
        old.revision.startsWith(`${page.updated_at}:`)
      ) {
        resources.set(id, {
          ...old,
          path: `${folder}/materials/pages/${resourceName(page.page_id, page.title)}.md`,
        });
        for (const match of (old.text || "").matchAll(/\/files\/(\d+)/g))
          fileIds.add(Number(match[1]));
        continue;
      }
      try {
        const detail = await canvasRead<any>(
          `${base}/pages/${encodeURIComponent(page.url)}`,
          signal,
        );
        if (!detail.locked_for_user)
          addDocument(
            `page:${page.page_id}`,
            `materials/pages/${resourceName(page.page_id, page.title)}.md`,
            page.title,
            `${location.origin}/courses/${course.id}/pages/${page.url}`,
            detail.body,
          );
      } catch (error) {
        signal.throwIfAborted();
        if (old) resources.set(id, old);
        errors.push(
          `${course.name}: ${page.title}: ${(error as Error).message}`,
        );
      }
    }
    const announcements = await list(
      `/api/v1/announcements?context_codes[]=course_${course.id}&start_date=1970-01-01&end_date=2100-01-01&per_page=100`,
      "announcement",
    );
    for (const a of announcements)
      addDocument(
        `announcement:${a.id}`,
        `materials/announcements/${resourceName(a.id, a.title)}.md`,
        a.title,
        a.html_url,
        a.message,
      );
    const modules = await list(
      `${base}/modules?include[]=items&per_page=100`,
      "module",
    );
    for (const module of modules) {
      const items: any[] =
        Array.isArray(module.items) &&
        module.items.length === module.items_count
          ? module.items
          : await list(
              `${base}/modules/${module.id}/items?per_page=100`,
              "module",
            );
      for (const item of items) {
        if (item.type === "File") fileIds.add(item.content_id);
        if (
          item.type === "Page" &&
          item.page_url &&
          !pages.some((page) => page.url === item.page_url)
        ) {
          try {
            const page = await single(
              `${base}/pages/${encodeURIComponent(item.page_url)}`,
              15 * 60 * 1000,
            );
            if (!page.locked_for_user)
              addDocument(
                `page:${page.page_id}`,
                `materials/pages/${resourceName(page.page_id, page.title)}.md`,
                page.title,
                page.html_url ||
                  `${location.origin}/courses/${course.id}/pages/${page.url}`,
                page.body,
              );
          } catch (error) {
            signal.throwIfAborted();
            errors.push(
              `${course.name}: ${item.title}: ${(error as Error).message}`,
            );
          }
        }
      }
      const text = items
        .map(
          (item) =>
            `- ${item.title} (${item.type}): ${item.external_url || item.html_url || item.url || ""}`,
        )
        .join("\n");
      addDocument(
        `module:${module.id}`,
        `materials/modules/${resourceName(module.id, module.name)}.md`,
        module.name,
        `${location.origin}/courses/${course.id}/modules`,
        "",
        text,
      );
    }
    const quizzes = await list(`${base}/quizzes?per_page=100`, "quiz");
    for (const quiz of quizzes)
      if (!quiz.locked_for_user)
        addDocument(
          `quiz:${quiz.id}`,
          `materials/quizzes/${resourceName(quiz.id, quiz.title)}.md`,
          quiz.title,
          quiz.html_url,
          quiz.description,
          `Due: ${quiz.due_at || "No due date"}\n\nThis is the quiz description only; question and answer content is not collected.`,
        );
    const discussions = await list(
      `${base}/discussion_topics?per_page=100`,
      "discussion",
    );
    for (const discussion of discussions)
      addDocument(
        `discussion:${discussion.id}`,
        `materials/discussions/${resourceName(discussion.id, discussion.title)}.md`,
        discussion.title,
        discussion.html_url,
        discussion.message,
      );
    const files = await list(`${base}/files?per_page=100`, "file");
    const knownFiles = new Map(files.map((file) => [file.id, file]));
    for (const id of fileIds)
      if (!knownFiles.has(id)) {
        try {
          knownFiles.set(
            id,
            await single(`/api/v1/files/${id}`, 15 * 60 * 1000),
          );
        } catch (error) {
          signal.throwIfAborted();
          errors.push(
            `${course.name}: file ${id}: ${(error as Error).message}`,
          );
        }
      }
    for (const file of knownFiles.values()) {
      if (file.locked_for_user || file.hidden_for_user) continue;
      const id = `${course.id}:file:${file.id}`;
      resources.set(id, {
        id,
        courseId: course.id,
        path: `${folder}/materials/files/${safeFilename(file.display_name || file.filename).replace(/(\.[^.]+)?$/, (_match, extension = "") => `--${file.id}${extension}`)}`,
        title: file.display_name || file.filename,
        sourceUrl:
          fileLinks.get(file.id) || `${location.origin}/files/${file.id}`,
        downloadUrl: file.url,
        size: file.size,
        revision: await sha256(
          JSON.stringify([
            file.updated_at,
            file.modified_at,
            file.size,
            file.filename,
          ]),
        ),
      });
    }
    const renamedFiles = [...resources.values()].filter(
      (resource) =>
        resource.courseId === course.id &&
        resource.id.includes(":file:") &&
        prior.get(resource.id)?.path !== resource.path,
    );
    for (const [id, resource] of resources) {
      if (
        resource.courseId !== course.id ||
        !resource.text ||
        !id.includes(":page:")
      )
        continue;
      let text = resource.text;
      for (const file of renamedFiles) {
        const old = prior.get(file.id);
        if (old) text = text.split(old.path).join(file.path);
      }
      if (text !== resource.text)
        resources.set(id, {
          ...resource,
          text,
          revision: `${resource.revision.slice(0, resource.revision.lastIndexOf(":"))}:${await sha256(text)}`,
        });
    }
    for (const document of documents) {
      const dom = new DOMParser().parseFromString(document.html, "text/html");
      for (const element of dom.querySelectorAll("a[href],img[src]")) {
        const attr = element.tagName === "IMG" ? "src" : "href";
        try {
          element.setAttribute(
            attr,
            new URL(element.getAttribute(attr)!, location.origin).href,
          );
        } catch {}
      }
      const links = [...dom.querySelectorAll("[href],[src]")].flatMap(
        (element) => {
          const raw =
            element.getAttribute("href") || element.getAttribute("src") || "";
          const match = raw.match(/\/files\/(\d+)/);
          const linked =
            match && resources.get(`${course.id}:file:${match[1]}`);
          return linked ? [`- ${linked.title}: ${linked.path}`] : [];
        },
      );
      const text = `# ${document.title}\n\nSource: ${document.url}\n\n${document.extra || ""}\n\n${markdown.turndown(dom.body.innerHTML)}\n\n${links.length ? `## Linked local files\n\n${[...new Set(links)].join("\n")}` : ""}\n`;
      const page = pages.find(
        (p) => document.id === `${course.id}:page:${p.page_id}`,
      );
      resources.set(document.id, {
        id: document.id,
        courseId: course.id,
        path: document.path,
        title: document.title,
        sourceUrl: document.url,
        revision: `${page?.updated_at || ""}:${await sha256(text)}`,
        text,
      });
    }
    // A failed endpoint must not make previously collected sources disappear.
    for (const old of prior.values())
      if (
        old.courseId === course.id &&
        failed.has(old.id.split(":")[1]) &&
        !resources.has(old.id)
      )
        resources.set(old.id, old);
    const entries = [...resources.values()]
      .filter((r) => r.courseId === course.id)
      .sort((a, b) => a.path.localeCompare(b.path))
      .map((r) => `- ${r.title}: ${r.path}`)
      .join("\n");
    const indexText = `# ${course.name} — material index\n\nCanvas source: ${location.origin}/courses/${course.id}\n\nOnly materials currently visible to this Canvas account are listed. Files retained on disk but absent here may be removed or no longer accessible. Recheck Canvas before relying on them.\n\n${entries}\n`;
    resources.set(`${course.id}:index`, {
      id: `${course.id}:index`,
      courseId: course.id,
      path: `${folder}/materials/index.md`,
      title: `${course.name} material index`,
      sourceUrl: `${location.origin}/courses/${course.id}`,
      text: indexText,
      revision: await sha256(indexText),
    });
  }
  return {
    checkedAt: new Date().toISOString(),
    resources: [...resources.values()],
    errors,
    notices: [...new Set(notices)],
    responses,
  };
}
