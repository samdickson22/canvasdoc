import { collectMaterials, sha256 } from "./material-collector";
import { store } from "./store";
import { preferences } from "./preferences";

const dateLabel = (date: string) =>
  new Date(date).toLocaleString(undefined, {
    timeZone: preferences.timeZone,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

type Snapshot = {
  title: string;
  href: string;
  revision: string;
  due?: string | null;
  submission?: string;
};
export type CatchUpState = {
  baseline: Record<string, Snapshot>;
  checkedAt?: string;
  digest: {
    at: string;
    first: boolean;
    checked: number;
    items: { id: string; title: string; href: string; detail: string }[];
    coverage: string[];
  };
};

// Only this explicit action advances the comparison. Material sync owns its own cache.
export async function catchUp(signal: AbortSignal): Promise<void> {
  const account = store.account();
  const previous = store.get().catchUp;
  const baseline = { ...previous?.baseline };
  const digest: CatchUpState["digest"] = {
    at: new Date().toISOString(),
    first: !previous?.checkedAt,
    checked: 0,
    items: [],
    coverage: [],
  };
  try {
    // No cached catalog: a failed source must not consume background-sync changes.
    const catalog = await collectMaterials(signal, undefined, undefined, true);
    digest.coverage = [...catalog.errors, ...(catalog.notices ?? [])];
    for (const resource of catalog.resources) {
      const kind = resource.id.split(":")[1];
      if (kind === "index" || kind === "module") continue;
      const url = new URL(resource.sourceUrl, location.origin);
      if (url.origin !== location.origin) continue;
      const current: Snapshot = {
        title: resource.title,
        href: url.pathname + url.search,
        revision: resource.contentRevision ?? resource.revision,
      };
      let openAssignment = false;
      if (kind === "assignment") {
        const endpoint = `/api/v1/courses/${resource.courseId}/assignments?include[]=submission&per_page=100`;
        const assignment = catalog.responses?.[endpoint]?.value.find(
          (a) => `${resource.courseId}:assignment:${a.id}` === resource.id,
        );
        if (!assignment) continue;
        openAssignment =
          assignment.submission?.workflow_state === "unsubmitted" &&
          !assignment.submission?.excused;
        current.due = assignment.due_at ?? null;
        current.submission = JSON.stringify([
          assignment.submission?.workflow_state ?? "unknown",
          assignment.submission?.submitted_at ?? null,
          assignment.submission?.score ?? null,
          assignment.submission?.grade ?? null,
          assignment.submission?.excused ?? false,
        ]);
        current.revision = await sha256(
          JSON.stringify([
            assignment.name,
            assignment.description,
            assignment.rubric,
            assignment.points_possible,
            assignment.submission_types,
            assignment.allowed_extensions,
            assignment.lock_at,
            assignment.unlock_at,
          ]),
        );
      }
      const old = baseline[resource.id];
      const details: string[] = [];
      if (!old) {
        if (digest.first) {
          if (openAssignment)
            details.push(
              current.due ? `Due ${dateLabel(current.due)}` : "No due date",
            );
        } else
          details.push(
            kind === "assignment"
              ? "New or newly available assignment"
              : "New or newly available material",
          );
      } else {
        if (old.due !== current.due)
          details.push(
            `Due date changed: ${old.due ? dateLabel(old.due) : "none"} → ${current.due ? dateLabel(current.due) : "none"}`,
          );
        if (old.submission !== current.submission)
          details.push("Submission or grade changed");
        if (old.revision !== current.revision)
          details.push(
            kind === "assignment"
              ? "Requirements changed"
              : kind === "announcement"
                ? "Announcement updated"
                : "Material updated",
          );
      }
      if (details.length)
        digest.items.push({
          id: resource.id,
          title: current.title,
          href: current.href,
          detail: details.join(" · "),
        });
      baseline[resource.id] = current;
      digest.checked++;
    }
  } catch (error) {
    signal.throwIfAborted();
    digest.coverage.push((error as Error).message);
  }
  if (digest.first) {
    const now = Date.now();
    const priority = (id: string) => {
      const due = baseline[id].due;
      if (!due) return Number.MAX_SAFE_INTEGER;
      const time = new Date(due).getTime();
      return time < now ? now - time : time;
    };
    digest.items.sort((a, b) => priority(a.id) - priority(b.id));
    digest.items = digest.items.slice(0, 5);
  }
  signal.throwIfAborted();
  if (store.account() !== account)
    throw new Error("Canvas account changed. Run catch-up again.");
  if (
    !(await store.saveCatchUp({
      baseline,
      checkedAt: digest.checked ? digest.at : previous?.checkedAt,
      digest,
    }))
  )
    throw new Error(
      "Catch-up could not be saved. Try again; the previous comparison is preserved.",
    );
}
