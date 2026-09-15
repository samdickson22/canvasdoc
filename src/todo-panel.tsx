import { useMemo, useState } from "react";
import { Skeleton } from "boneyard-js/react";
import todoBones from "./todo.bones";
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Circle,
  ListTodo,
  Plus,
  Settings2,
} from "lucide-react";
import type { Course, PersonalTask, Todo } from "./types";
import { dueGroup } from "./model";
import { preferences } from "./preferences";
import { store } from "./store";
import spaceBetween from "./bettercampus/spaceBetween";
import strokeWidth from "./bettercampus/strokeWidth";
export const courseColors = [
  "#496044",
  "#385aa2",
  "#92379f",
  "#bc8050",
  "#bd3868",
  "#387e7b",
];
export function TodoList({
  todos,
  courses,
  tasks,
  loading,
  error,
  retry,
  onAdd,
}: {
  todos: Todo[];
  courses: Course[];
  tasks: PersonalTask[];
  loading: boolean;
  error: string;
  retry: () => void;
  onAdd: () => void;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const [completed, setCompleted] = useState(false);
  const [period, setPeriod] = useState("week");
  const [offset, setOffset] = useState(0);
  const [settings, setSettings] = useState(false);
  const [showOverdue, setShowOverdue] = useState(true);
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7) + offset * 7);
  const end = new Date(date);
  end.setDate(end.getDate() + 7);
  const items = useMemo(
    () => [
      ...todos
        .filter((t) => t.assignment)
        .map((t) => ({
          id: `assignment:${t.assignment!.course_id}:${t.assignment!.id}`,
          title: t.assignment!.name,
          course: t.context_short_name || t.context_name || "",
          courseId: t.assignment!.course_id,
          due: t.assignment!.due_at,
          href: `/courses/${t.assignment!.course_id}/assignments/${t.assignment!.id}`,
          personal: false,
          completed: ["submitted", "graded", "pending_review"].includes(
            t.assignment!.submission?.workflow_state || "",
          ),
          points: t.assignment!.points_possible,
        })),
      ...tasks.map((t) => ({
        id: t.id,
        title: t.title,
        course:
          courses.find((c) => c.id === t.courseId)?.course_code || "Personal",
        courseId: t.courseId || 0,
        due: t.dueAt,
        href: `/?canvasdoc-task=${encodeURIComponent(t.id)}`,
        personal: true,
        completed: t.completed,
        points: null,
      })),
    ],
    [todos, tasks, courses],
  );
  const inPeriod = (item: (typeof items)[number]) =>
    period === "all" ||
    (item.due && +new Date(item.due) >= +date && +new Date(item.due) < +end);
  const periodItems = items.filter(inPeriod);
  const bars = courses
    .filter((c) => periodItems.some((i) => i.courseId === c.id))
    .map((c) => ({
      id: c.id,
      name: c.course_code,
      color: courseColors[c.id % courseColors.length],
      total: periodItems.filter((i) => i.courseId === c.id).length,
      done: periodItems.filter((i) => i.courseId === c.id && i.completed)
        .length,
    }));
  const progress = periodItems.filter(
    (i) => selected === null || i.courseId === selected,
  );
  const done = progress.filter((i) => i.completed).length;
  const visible = items
    .filter(
      (i) =>
        (selected === null || i.courseId === selected) &&
        i.completed === completed &&
        (inPeriod(i) ||
          (!completed &&
            showOverdue &&
            offset === 0 &&
            i.due &&
            +new Date(i.due) < +date)),
    )
    .sort(
      (a, b) =>
        (a.due ? +new Date(a.due) : Infinity) -
        (b.due ? +new Date(b.due) : Infinity),
    );
  const groups = [
    "Overdue",
    "Today",
    "Tomorrow",
    "Next 7 days",
    "Later",
    "No due date",
  ]
    .map((label) => ({
      label,
      items: visible.filter(
        (i) => dueGroup(i.due, new Date(), preferences.timeZone) === label,
      ),
    }))
    .filter((g) => g.items.length);
  const width = Math.min(
    14,
    strokeWidth(Math.max(1, bars.length), 130, 55, spaceBetween(bars.length)),
  );
  const labelDate = (d: Date) =>
    d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const endLabel = new Date(+end - 1);
  if (loading && !items.length) return <Skeleton name="canvasdoc-todos" loading initialBones={todoBones} className="bc-loading" color="#edf0e8" animate="pulse"><span /></Skeleton>;
  return (
    <div className="bc-todos">
      <div className="bc-period">
        <select
          aria-label="Task date range"
          value={period}
          onChange={(e) => setPeriod(e.target.value)}
        >
          <option value="week">Week</option>
          <option value="all">All dates</option>
        </select>
        <button
          aria-label="Previous week"
          disabled={period === "all"}
          onClick={() => setOffset((o) => o - 1)}
        >
          <ChevronLeft size={18} />
        </button>
        <button
          className="bc-date-range"
          onClick={() => setOffset(0)}
          title="Return to this week"
        >
          {period === "all"
            ? "All coursework"
            : `${labelDate(date)} – ${labelDate(endLabel)}`}
        </button>
        <button
          aria-label="Next week"
          disabled={period === "all"}
          onClick={() => setOffset((o) => o + 1)}
        >
          <ChevronRight size={18} />
        </button>
        <button
          aria-label="To-do settings"
          aria-expanded={settings}
          onClick={() => setSettings((s) => !s)}
        >
          <Settings2 size={17} />
        </button>
      </div>
      {settings && (
        <div className="bc-settings">
          <label>
            <input
              type="checkbox"
              checked={showOverdue}
              onChange={(e) => setShowOverdue(e.target.checked)}
            />{" "}
            Include earlier overdue work
          </label>
          <p>
            Course rings filter the list. Progress comes from Canvas submissions
            and completed personal tasks.
          </p>
        </div>
      )}
      <div className="bc-wheel">
        <svg viewBox="0 0 300 165" aria-label="Course progress filters">
          {bars.map((b, index) => {
            const radius = 130 - index * (width + 6);
            const d = `M ${150 - radius} 145 A ${radius} ${radius} 0 0 1 ${150 + radius} 145`;
            return (
              <g
                key={b.id}
                role="button"
                tabIndex={0}
                aria-label={`${b.name}: ${b.done} of ${b.total} complete. Filter course`}
                aria-pressed={selected === b.id}
                onClick={() => setSelected(selected === b.id ? null : b.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setSelected(selected === b.id ? null : b.id);
                  }
                }}
                style={{
                  opacity: selected === null || selected === b.id ? 1 : 0.24,
                }}
              >
                <path
                  d={d}
                  fill="none"
                  stroke={b.color}
                  strokeOpacity=".2"
                  strokeWidth={width}
                  strokeLinecap="round"
                />
                <path
                  d={d}
                  fill="none"
                  stroke={b.color}
                  strokeWidth={width}
                  strokeLinecap="round"
                  pathLength="100"
                  strokeDasharray={`${b.total ? (b.done / b.total) * 100 : 0} 100`}
                />
              </g>
            );
          })}
        </svg>
        <div className="bc-progress">
          <strong>
            {progress.length ? Math.round((done / progress.length) * 100) : 0}%
          </strong>
          <span>
            {done}/{progress.length}
          </span>
        </div>
      </div>
      <div className="bc-legend">
        {bars.map((b) => (
          <button
            key={b.id}
            aria-pressed={selected === b.id}
            onClick={() => setSelected(selected === b.id ? null : b.id)}
          >
            <i style={{ background: b.color }} />
            {b.name}
          </button>
        ))}
        {selected !== null && (
          <button onClick={() => setSelected(null)}>Show all</button>
        )}
      </div>
      <div className="bc-task-tabs">
        <button aria-pressed={!completed} onClick={() => setCompleted(false)}>
          <ListTodo size={19} /> To do
        </button>
        <button aria-pressed={completed} onClick={() => setCompleted(true)}>
          <Check size={19} /> Completed
        </button>
      </div>
      {loading ? (
        <p className="loading">Loading coursework…</p>
      ) : error ? (
        <div className="error">
          {error}
          <button onClick={retry}>Retry</button>
        </div>
      ) : groups.length ? (
        groups.map((g) => (
          <section className="bc-group" key={g.label}>
            <button
              className="bc-group-heading"
              aria-expanded={!collapsed.includes(g.label)}
              onClick={() =>
                setCollapsed((c) =>
                  c.includes(g.label)
                    ? c.filter((x) => x !== g.label)
                    : [...c, g.label],
                )
              }
            >
              <span>{g.label}</span>
              <small>{g.items.length}</small>
              <ChevronDown
                size={16}
                style={{
                  transform: collapsed.includes(g.label)
                    ? "rotate(-90deg)"
                    : undefined,
                }}
              />
            </button>
            {!collapsed.includes(g.label) &&
              g.items.map((item) => (
                <div
                  key={item.id}
                  className="bc-task"
                  style={
                    {
                      "--course-color":
                        courseColors[item.courseId % courseColors.length],
                    } as React.CSSProperties
                  }
                >
                  <a href={item.href}>
                    <small>{item.course}</small>
                    <strong>{item.title}</strong>
                    <span>
                      {item.due
                        ? `Due ${new Date(item.due).toLocaleString(undefined, { month: "2-digit", day: "2-digit", hour: "numeric", minute: "2-digit", timeZone: preferences.timeZone })}`
                        : "No due date"}
                      <em>
                        {item.personal ? "Personal" : `${item.points ?? 0} pts`}
                      </em>
                    </span>
                  </a>
                  {item.personal ? (
                    <button
                      className="bc-check"
                      aria-label={`${item.completed ? "Reopen" : "Complete"} ${item.title}`}
                      onClick={() => store.toggleTask(item.id)}
                    >
                      {item.completed ? (
                        <Check size={19} />
                      ) : (
                        <Circle size={19} />
                      )}
                    </button>
                  ) : (
                    <span
                      className="bc-check"
                      title={
                        item.completed ? "Submitted in Canvas" : "Not submitted"
                      }
                    >
                      {item.completed ? (
                        <Check size={19} />
                      ) : (
                        <Circle size={19} />
                      )}
                    </span>
                  )}
                </div>
              ))}
          </section>
        ))
      ) : (
        <div className="bc-empty">
          <Check size={24} />
          <strong>
            {completed
              ? "Nothing completed in this view"
              : "You’re caught up in this view"}
          </strong>
          <button
            onClick={() => {
              setPeriod("all");
              setSelected(null);
            }}
          >
            View all dates and courses
          </button>
        </div>
      )}
      <button className="bc-add" onClick={onAdd}>
        <Plus size={18} /> Add task
      </button>
    </div>
  );
}
