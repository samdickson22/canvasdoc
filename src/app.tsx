import { transitionView } from "./transitions";
import { localFilePath } from "./workspace-files";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  ChevronDown,
  Circle,
  ExternalLink,
  Link,
  MessageSquare,
  Plus,
  PanelLeft,
  PanelLeftClose,
  RefreshCw,
  Settings2,
  Sparkles,
  X,
} from "lucide-react";
import { observeCanvasWork } from "./material-sync";
import { MaterialStatus } from "./material-status";
import { Workspace } from "./workspace";
import { Navigation } from "./navigation";
import { TodoList } from "./todo-panel";
import { Conversation } from "./conversation";
import { visibleHomeMessages } from "./runtime/home-view";
import { readAssignment, readCourses, readDashboardWork } from "./canvas";
import { dueGroup, newTask, safeLink } from "./model";
import { store, useData, useStorageError } from "./store";
import type {
  Assignment,
  Course,
  PageContext,
  PersonalTask,
  Todo,
} from "./types";
import {
  connect,
  disconnect,
  useConnection,
  reconnectAgent,
  connectNative,
  usesNativeConnection,
} from "./runtime/client";
import { preferences } from "./preferences";

export type Mounts = {
  sidebar: HTMLElement;
  navigation: HTMLElement;
  conversation: HTMLElement | null;
  conversationHost: HTMLElement | null;
  main: HTMLElement | null;
  tabs: HTMLElement | null;
  workspace: HTMLElement | null;
  original: HTMLElement[];
};
const colors = ["#496b54", "#687ab2", "#a378a1", "#b78c56"];
const shortName = (name: string) => name.replace(/^\[DEV\]\s*/, "");
const dateLabel = (value: string | null) =>
  value
    ? new Date(value).toLocaleString(undefined, {
        timeZone: preferences.timeZone,
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "No due date";

export function App({
  initialContext,
  mounts,
}: {
  initialContext: PageContext;
  mounts: Mounts;
}) {
  const data = useData();
  useLayoutEffect(() => {
    document.documentElement.classList.toggle("canvasdoc-dashboard", initialContext.kind === "home");
    document.documentElement.classList.remove("canvasdoc-booting");
    performance.mark("canvasdoc:ready");
    window.dispatchEvent(new Event("canvasdoc:ready"));
    return () => document.documentElement.classList.remove("canvasdoc-dashboard");
  }, [initialContext.kind]);
  const activeDashboard = initialContext.kind === "home" && visibleHomeMessages(data.threads[initialContext.threadId]?.messages).length > 0;
  useEffect(() => {
    document.documentElement.classList.toggle("canvasdoc-chat-active", activeDashboard);
    return () => document.documentElement.classList.remove("canvasdoc-chat-active");
  }, [activeDashboard]);
  const connection = useConnection();
  const connectionLabel =
    connection.status === "connected"
      ? "Computer connected"
      : connection.status === "connecting"
        ? "Connecting…"
        : "Connect your computer";
  const storageError = useStorageError();
  const [courses, setCourses] = useState<Course[]>(() => data.canvasCache?.courses ?? []);
  const [todos, setTodos] = useState<Todo[]>(() => data.canvasCache?.todos ?? []);
  const [assignment, setAssignment] = useState<Assignment | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(!data.canvasCache);
  const [refreshing, setRefreshing] = useState(false);
  const [revision, setRevision] = useState(0);
  const [open, setOpen] = useState(() => initialContext.kind !== "page" && window.innerWidth > 1100);
  const [workspace, setWorkspace] = useState(false);
  const navigationCollapsed = data.workspaceNavigationCollapsed === true;
  const [requestedFile, setRequestedFile] = useState<{path:string}>();
  useEffect(() => {
    const openFile = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if(detail?.threadId !== initialContext.threadId || typeof detail.path !== "string" || !mounts.workspace) return;
      const path = localFilePath(detail.path);
      if(!path) return;
      setRequestedFile({path});
      void transitionView(() => setWorkspace(true));
    };
    window.addEventListener("canvasdoc:open-file",openFile);
    return () => window.removeEventListener("canvasdoc:open-file",openFile);
  }, [initialContext.threadId, mounts.workspace]);
  const [modal, setModal] = useState<"task" | "connection" | null>(null);
  useEffect(() => {
    const narrow = window.matchMedia("(max-width: 1100px)");
    const closeOnNarrow = () => { if(narrow.matches) setOpen(false); };
    narrow.addEventListener("change", closeOnNarrow);
    return () => narrow.removeEventListener("change",closeOnNarrow);
  }, []);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if(event.key === "Escape" && !event.defaultPrevented && !modal && open && !workspace) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown",escape);
    return () => window.removeEventListener("keydown",escape);
  }, [modal,open,workspace]);
  const personal = data.tasks.find((task) => task.id === initialContext.taskId);
  const context = {
    ...initialContext,
    title: assignment?.name ?? personal?.title ?? initialContext.title,
  };
  useEffect(() => {
    const controller = new AbortController();
    setLoading(!store.get().canvasCache);
    setRefreshing(true);
    setError("");
    const coursesRequest = readCourses(controller.signal);
    Promise.all([
      coursesRequest,
      initialContext.kind === "home"
        ? coursesRequest.then(courses => readDashboardWork(controller.signal, courses))
        : Promise.resolve([]),
      initialContext.kind === "assignment"
        ? readAssignment(
            initialContext.courseId!,
            initialContext.assignmentId!,
            controller.signal,
          )
        : Promise.resolve(null),
    ])
      .then(([nextCourses, nextTodos, nextAssignment]) => {
        setCourses(nextCourses);
        setTodos(nextTodos);
        setAssignment(nextAssignment);
        if (!controller.signal.aborted) observeCanvasWork(nextCourses,initialContext.kind === "home" ? nextTodos : undefined,nextAssignment || undefined);
        if (!controller.signal.aborted) void store.cacheCanvas({courses:nextCourses,todos:initialContext.kind === "home" ? nextTodos : store.get().canvasCache?.todos ?? [],fetchedAt:new Date().toISOString()});
      })
      .catch((err) => {
        if (!controller.signal.aborted) setError(err.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) { setLoading(false); setRefreshing(false); }
      });
    return () => controller.abort();
  }, [
    revision,
    initialContext.kind,
    initialContext.courseId,
    initialContext.assignmentId,
  ]);
  useEffect(() => {
    document.body.classList.toggle("canvasdoc-sidebar-open", open && !workspace);
    return () => document.body.classList.remove("canvasdoc-sidebar-open");
  }, [open, workspace]);
  useLayoutEffect(() => {
    document.body.classList.toggle("canvasdoc-workspace-open", workspace);
    document.body.classList.toggle("canvasdoc-navigation-collapsed", workspace && navigationCollapsed);
    const navigationHost = (mounts.navigation.getRootNode() as ShadowRoot).host as HTMLElement;
    navigationHost.hidden = workspace && navigationCollapsed;
    for (const element of mounts.original) element.hidden = workspace;
    if (mounts.workspace) mounts.workspace.hidden = !workspace;
    return () => {
      document.body.classList.remove("canvasdoc-workspace-open", "canvasdoc-navigation-collapsed");
      navigationHost.hidden = false;
      for (const element of mounts.original) element.hidden = false;
    };
  }, [workspace, navigationCollapsed, mounts]);
  const onConnect = () => setModal("connection");
  const course = courses.find((item) => item.id === context.courseId);
  return (
    <>
      {mounts.conversation && createPortal(<Conversation key={context.threadId} context={context} workMode={workspace} onConnect={onConnect} />, mounts.conversation)}
      {createPortal(<Navigation courses={courses} />, mounts.navigation)}
      {createPortal(
        workspace ? null : open ? (
          <>
          <button className="sidebar-backdrop" aria-label="Close Canvasdoc sidebar" onClick={() => void transitionView(() => setOpen(false))} />
          <aside
            className="sidebar"
            aria-label={
              context.kind === "home" ? "To-do list" : "Assignment conversation"
            }
          >
            <header className="sidebar-header">
              <strong>{context.kind === "home" ? "To-do" : "Canvasdoc"}</strong>
              {context.kind !== "home" && <button className="connection-status" data-status={connection.status} onClick={onConnect} title={connectionLabel} aria-label={connectionLabel}><i /></button>}
              <div className="header-actions">
                {context.kind === "home" && (
                  <button
                    className="icon-button"
                    aria-label="Refresh Canvas to-dos"
                    aria-busy={refreshing}
                    title={refreshing ? "Refreshing coursework from Canvas" : "Refresh coursework from Canvas"}
                    onClick={() => setRevision((value) => value + 1)}
                  >
                    <RefreshCw size={16} className={refreshing ? "spin" : ""} />
                  </button>
                )}
                <button
                  className="icon-button"
                  aria-label="Connection settings"
                  onClick={onConnect}
                >
                  <Settings2 size={17} />
                </button>
                <button
                  className="icon-button"
                  aria-label="Collapse Canvasdoc sidebar"
                  onClick={() => void transitionView(() => setOpen(false))}
                >
                  <X size={18} />
                </button>
              </div>
            </header>
            {context.kind === "home" ? (
              <TodoList
                todos={todos}
                courses={courses}
                tasks={data.tasks}
                loading={loading}
                error={error}
                retry={() => setRevision((value) => value + 1)}
                onAdd={() => setModal("task")}
              />
            ) : (
              <>
                {error && (
                  <p className="error" role="alert">
                    {error}{" "}
                    <button onClick={() => setRevision((value) => value + 1)}>
                      Retry
                    </button>
                  </p>
                )}
                <div className="conversation-slot" ref={node => { if(node && mounts.conversationHost && mounts.conversationHost.parentNode !== node) node.append(mounts.conversationHost); }} />
              </>
            )}
            {storageError && (
              <p className="error" role="alert">
                {storageError}
              </p>
            )}
          </aside>
          </>
        ) : (
          <button className="launcher" aria-label={context.kind === "home" ? "Open to-do list" : "Open Canvasdoc conversation"} onClick={() => void transitionView(() => setOpen(true))}>
            <MessageSquare size={18} /> Canvasdoc
          </button>
        ),
        mounts.sidebar,
      )}
      {mounts.main &&
        createPortal(
          context.kind === "home" ? (
            <main className="dashboard">
              <header className="dashboard-header">
                <span>Home</span>
                <button className="connection-status" data-status={connection.status} onClick={onConnect}>
                  <i /> {connectionLabel}
                </button>
              </header>
              <div className="dashboard-center">
                <Conversation context={context} home onConnect={onConnect} />
                <RecentWork />
              </div>
              <footer className="dashboard-footer">
                <BookOpen size={14} /> Canvas is the source for your courses and
                assignments.
                <MaterialStatus />
              </footer>
            </main>
          ) : (
            <PersonalPage task={personal} />
          ),
          mounts.main,
        )}
      {mounts.tabs &&
        createPortal(
          <div className={workspace ? "assignment-toolbar workspace-toolbar" : "assignment-toolbar"}>
            {workspace && (
              <button
                className="navigation-toggle"
                aria-label={navigationCollapsed ? "Show navigation sidebar" : "Hide navigation sidebar"}
                title={navigationCollapsed ? "Show navigation sidebar" : "Hide navigation sidebar"}
                aria-expanded={!navigationCollapsed}
                onClick={() => void store.setWorkspaceNavigationCollapsed(!navigationCollapsed)}
              >
                {navigationCollapsed ? <PanelLeft size={18} /> : <PanelLeftClose size={18} />}
              </button>
            )}
          <div
            className="assignment-tabs"
            role="tablist"
            aria-label="Assignment view"
          >
            <button
              role="tab"
              aria-selected={!workspace}
              id="canvasdoc-assignment-tab"
              tabIndex={!workspace ? 0 : -1}
              onClick={() => void transitionView(() => setWorkspace(false))}
              onKeyDown={(e) => {
                if (e.key === "ArrowRight") {
                  void transitionView(() => setWorkspace(true));
                  e.currentTarget.nextElementSibling instanceof HTMLElement &&
                    e.currentTarget.nextElementSibling.focus();
                }
              }}
            >
              Assignment
            </button>
            <button
              role="tab"
              aria-selected={workspace}
              id="canvasdoc-workspace-tab"
              tabIndex={workspace ? 0 : -1}
              onClick={() => void transitionView(() => setWorkspace(true))}
              onKeyDown={(e) => {
                if (e.key === "ArrowLeft") {
                  void transitionView(() => setWorkspace(false));
                  e.currentTarget.previousElementSibling instanceof
                    HTMLElement &&
                    e.currentTarget.previousElementSibling.focus();
                }
              }}
            >
              Workspace
            </button>
          </div>
          </div>,
          mounts.tabs,
        )}
      {mounts.workspace &&
        createPortal(
          <Workspace active={workspace} requestedFile={requestedFile} context={context} conversationHost={mounts.conversationHost!} onAssignment={() => void transitionView(() => setWorkspace(false))} onConnect={onConnect} />,
          mounts.workspace,
        )}
      {modal &&
        createPortal(
          <Modal
            title={modal === "task" ? "New task" : "Connect your computer"}
            onClose={() => setModal(null)}
          >
            {modal === "task" ? (
              <TaskForm courses={courses} onClose={() => setModal(null)} />
            ) : (
              <><ConnectionSettings /><MaterialStatus /></>
            )}
          </Modal>,
          mounts.sidebar,
        )}
    </>
  );
}

function RecentWork() {
  const { threads, tasks, canvasCache } = useData();
  const details = (thread: { id: string; href: string }) => {
    const assignmentIds = thread.id.match(/^assignment:(\d+):(\d+)$/);
    const task = tasks.find(item => thread.id === `personal:${item.id}`);
    const courseId = assignmentIds ? Number(assignmentIds[1]) : task?.courseId ?? Number(thread.href.match(/\/courses\/(\d+)/)?.[1]);
    const course = canvasCache?.courses.find(item => item.id === courseId);
    const assignment = assignmentIds ? canvasCache?.todos.find(item => item.assignment?.id === Number(assignmentIds[2]) && item.assignment?.course_id === courseId)?.assignment : undefined;
    const courseLabel = course ? shortName(course.name) : task ? "Personal task" : courseId ? "Course" : "Canvas";
    const due = assignment?.due_at ?? task?.dueAt;
    return [courseLabel, due ? `Due ${dateLabel(due)}` : assignment || task ? "No due date" : null].filter(Boolean).join(" · ");
  };
  const recent = Object.values(threads)
    .filter(
      (thread) =>
        thread.id !== "home" && (thread.messages.length || thread.draft.trim()),
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 4);
  if (!recent.length)
    return (
      <div className="recent-empty">
        <span>Your work will pick up here.</span>
        <p>Open an assignment from your to-dos to start its conversation.</p>
      </div>
    );
  return (
    <section className="recent">
      <h2>Recent work</h2>
      {recent.map((thread) => (
        <a key={thread.id} href={thread.href}>
          <MessageSquare size={17} />
          <span>
            {thread.title}
            <small>{details(thread)}</small>
          </span>
          <ArrowRight size={16} />
        </a>
      ))}
    </section>
  );
}


function PersonalPage({ task }: { task?: PersonalTask }) {
  return (
    <main className="personal-page">
      <a href="/" className="back-link">
        <ArrowLeft size={15} /> Dashboard
      </a>
      {task ? (
        <>
          <div className="eyebrow">PERSONAL TASK</div>
          <h1>{task.title}</h1>
          <p className="muted">{dateLabel(task.dueAt)}</p>
          {task.description && (
            <p className="personal-description">{task.description}</p>
          )}
          {task.link && safeLink(task.link, location.origin) && (
            <a
              className="resource-link"
              href={safeLink(task.link, location.origin)!}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Link size={16} /> Open linked resource <ExternalLink size={14} />
            </a>
          )}
          <button
            className="secondary-button"
            onClick={() => store.toggleTask(task.id)}
          >
            <Check size={16} />{" "}
            {task.completed ? "Mark incomplete" : "Mark complete"}
          </button>
        </>
      ) : (
        <>
          <h1>Task not found</h1>
          <p>This personal task is not saved in this browser account.</p>
        </>
      )}
    </main>
  );
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal"
      onCancel={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          const r = event.currentTarget.getBoundingClientRect();
          if (
            event.clientX < r.left ||
            event.clientX > r.right ||
            event.clientY < r.top ||
            event.clientY > r.bottom
          )
            onClose();
        }
      }}
      aria-label={title}
    >
      <div className="modal-header">
        <h2>{title}</h2>
        <button
          className="icon-button"
          onClick={onClose}
          aria-label="Close dialog"
        >
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}

function TaskForm({
  courses,
  onClose,
}: {
  courses: Course[];
  onClose: () => void;
}) {
  const [error, setError] = useState("");
  return (
    <form
      className="task-form"
      onSubmit={async (event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const link = String(form.get("link") ?? "").trim();
        if (link && !safeLink(link, location.origin)) {
          setError("Use an http or https link.");
          return;
        }
        try {
          const due = String(form.get("due") ?? "");
          const task = newTask({
            title: String(form.get("title")),
            description: String(form.get("description") ?? ""),
            link: link ? safeLink(link, location.origin)! : "",
            courseId: form.get("course") ? Number(form.get("course")) : null,
            dueAt: due ? new Date(due).toISOString() : null,
          });
          await store.addTask(task);
          if (store.error()) {
            setError(store.error());
            return;
          }
          onClose();
        } catch (err) {
          setError(err instanceof Error ? err.message : "Could not save task.");
        }
      }}
    >
      <input
        autoFocus
        className="task-title"
        name="title"
        aria-label="Task title"
        placeholder="What do you need to do?"
        required
        maxLength={200}
      />
      <textarea
        name="description"
        aria-label="Task description"
        placeholder="Description (optional)"
        rows={3}
        maxLength={10000}
      />
      <div className="link-input">
        <Link size={17} />
        <input
          name="link"
          aria-label="Task link"
          placeholder="Add a link (optional)"
          maxLength={2000}
        />
      </div>
      <div className="task-details">
        <span className="eyebrow">DETAILS</span>
        <label>
          <span>Course</span>
          <select name="course" defaultValue="">
            <option value="">No course</option>
            {courses.map((course) => (
              <option key={course.id} value={course.id}>
                {shortName(course.name)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Due date</span>
          <input name="due" type="datetime-local" />
        </label>
      </div>
      <div className="task-privacy">Personal task · Only in Canvasdoc</div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <footer>
        <button type="button" className="text-button" onClick={onClose}>
          Cancel
        </button>
        <button className="primary-button" type="submit">
          <Plus size={17} /> Add task
        </button>
      </footer>
    </form>
  );
}

function ConnectionSettings() {
  const state = useConnection();
  const [error, setError] = useState("");
  return (
    <div className="connection-content">
      <p>Connect the Codex runtime started from your Canvasdoc folder.</p>
      {state.status === "connected" ? (
        <>
          <div className="connection-detail">Connected · {state.root}</div>
          <p className="muted">
            Conversations load from this browser. Local history exports run in
            the background.
          </p>
          <button className="secondary-button" onClick={disconnect}>
            Disconnect
          </button>
        </>
      ) : state.canReconnectAgent ? (
        <><p>Your computer is connected, but Codex needs to reconnect.</p><button className="primary-button" onClick={() => { try { reconnectAgent(); } catch (error) { setError((error as Error).message); } }}>Reconnect agent</button></>
      ) : usesNativeConnection ? (
        <>
          <p>
            Start the Canvasdoc connector from your selected folder, then
            reconnect.
          </p>
          <button className="primary-button" onClick={connectNative}>
            Reconnect
          </button>
        </>
      ) : (
        <form
          className="connection-form"
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            try {
              connect(String(data.get("url")), String(data.get("token")));
              setError("");
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          <label>
            Connector URL
            <input
              name="url"
              aria-label="Connector URL"
              defaultValue="wss://mac-mini.tail39179a.ts.net:3219"
              required
            />
          </label>
          <label>
            Connection token
            <input
              name="token"
              aria-label="Connection token"
              type="password"
              required
              autoComplete="off"
            />
          </label>
          <p className="muted">
            Development connection. Token stays in this browser session. The
            production extension will use native messaging.
          </p>
          <button
            className="primary-button"
            disabled={state.status === "connecting"}
          >
            {state.status === "connecting" ? "Connecting…" : "Connect"}
          </button>
        </form>
      )}
      {(error || state.error) && (
        <p className="error" role="alert">
          {error || state.error}
        </p>
      )}
    </div>
  );
}
