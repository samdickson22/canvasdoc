// Per-tool renderers for the Codex items Canvasdoc's companion normalizes. Built on the
// terminal-block, file-tree, tool-call, and tool-error designs from assistant-ui's elements.
import { useContext, useEffect, useState, type PropsWithChildren, type ReactNode } from "react";
import type { ToolCallMessagePartProps } from "@assistant-ui/react";
import { AlertCircleIcon, CheckIcon, ChevronRightIcon, FileIcon, FolderIcon, Loader2Icon, XCircleIcon } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../../ui/collapsible";
import { cn } from "../../../lib/utils";
import { chip, collapsePanel, field, mono, paper, ShimmerLabel, take } from "./surfaces";
import { useConnection } from "../../../../runtime/client";
import { ToolFallback } from "./tool-fallback.aui";
import { WorkHistoryControl } from "./run-activity";

type Lifecycle = "running" | "completed" | "failed" | "interrupted";
const lifecycle = (p: ToolCallMessagePartProps): Lifecycle => {
  const l = p.providerMetadata?.canvasdoc?.lifecycle as Lifecycle | undefined;
  if (l === "interrupted") return "interrupted";
  if (p.isError) return "failed";
  return p.result === undefined ? "running" : "completed";
};
const text = (value: unknown) => typeof value === "string" ? value : value == null ? "" : JSON.stringify(value, null, 2);
const unwrapShell = (command: string) => command.match(/^(?:\/\w+\/)*(?:zsh|bash|sh)\s+-lc\s+'([\s\S]*)'$/)?.[1]?.replace(/'\\''/g, "'") ?? command;
const useRelative = () => {
  const { root } = useConnection();
  return (path: string) => root && path.startsWith(root) ? path.slice(root.length).replace(/^\//, "") || "." : path;
};
const StatusIcon = ({ state }: { state: Lifecycle }) =>
  state === "running" ? <Loader2Icon className="text-foreground/40 size-3.5 shrink-0 animate-spin motion-reduce:animate-none" />
  : state === "failed" ? <XCircleIcon className="size-3.5 shrink-0 text-red-600" />
  : state === "interrupted" ? <AlertCircleIcon className="size-3.5 shrink-0 text-amber-600" />
  : <CheckIcon className="size-3.5 shrink-0 text-emerald-600" />;

/** One row in the work history: verb, target chip, status, and details on demand. */
function ToolRow({ state, verb, activeVerb, target, children }: PropsWithChildren<{ state: Lifecycle; verb: string; activeVerb: string; target?: string }>) {
  const [open, setOpen] = useState(false);
  const running = state === "running";
  return (
    <Collapsible data-slot="tool-row" open={open} onOpenChange={setOpen} className="w-full">
      <CollapsibleTrigger className="group/trigger text-foreground/60 hover:text-foreground/90 flex w-full max-w-full items-center gap-2 rounded-md py-1 text-left text-[13px] outline-none transition-colors">
        <ChevronRightIcon className="size-3.5 shrink-0 opacity-60 transition-transform duration-200 group-data-panel-open/trigger:rotate-90 motion-reduce:transition-none" />
        <ShimmerLabel active={running} className="shrink-0 leading-none">{running ? activeVerb : verb}</ShimmerLabel>
        {target && <span className={chip} title={target}>{target}</span>}
        <span className="ms-auto flex shrink-0 items-center"><StatusIcon state={state} /></span>
      </CollapsibleTrigger>
      <CollapsibleContent className={cn(collapsePanel, "outline-none")}><div className="pt-2 ps-5">{children}</div></CollapsibleContent>
    </Collapsible>
  );
}

function TerminalBlock({ command, cwd, lines, state, exitCode, className }: { command: string; cwd?: string; lines: readonly string[]; state: Lifecycle; exitCode?: number; className?: string }) {
  const done = state !== "running";
  const shown = lines.slice(-60);
  return (
    <div data-slot="terminal-block" className={cn(paper, "w-full overflow-hidden rounded-2xl font-mono text-xs", className)}>
      <div className="flex items-start justify-between gap-3 px-4 pt-3 pb-1.5">
        <span className="text-foreground/90 min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere]">{command}</span>
        <span className={cn(mono, "flex shrink-0 items-center gap-1 pt-0.5", done ? "text-foreground/40" : "text-foreground/35")}>
          {done ? <><StatusIcon state={state} />{typeof exitCode === "number" ? `exit ${exitCode}` : state}</> : <Loader2Icon className="size-3 animate-spin motion-reduce:animate-none" />}
        </span>
      </div>
      {cwd && cwd !== "." && <div className={cn(mono, "text-foreground/35 px-4 pb-1.5")}>in {cwd}</div>}
      {(shown.length > 0 || !done) && (
        <div className="text-foreground/60 flex max-h-72 flex-col gap-0.5 overflow-auto px-4 pt-1 pb-3.5 whitespace-pre-wrap [overflow-wrap:anywhere]">
          {shown.length < lines.length && <div className="text-foreground/35">… {lines.length - shown.length} earlier lines</div>}
          {shown.map((line, i) => <div key={i} className={cn(i === shown.length - 1 && done && "text-foreground/90")}>{line || " "}</div>)}
          {!done && <span aria-hidden className="inline-block h-3 w-1.5 animate-pulse bg-emerald-600/70 motion-reduce:animate-none" />}
        </div>
      )}
    </div>
  );
}

function ToolError({ name, target, message }: { name: string; target?: string; message: string }) {
  return (
    <div data-slot="tool-error" className={cn(paper, "flex w-full flex-col gap-3 rounded-2xl p-3.5")}>
      <div className="flex items-center gap-2.5">
        <AlertCircleIcon className="size-3.5 shrink-0 text-red-600" />
        <span className={cn(mono, "text-foreground/55 shrink-0")}>{name}</span>
        {target && <span className="text-foreground/80 min-w-0 flex-1 truncate text-[13px]">{target}</span>}
      </div>
      {message && <pre className={cn(field, "m-0 max-h-60 overflow-auto whitespace-pre-wrap rounded-xl px-3 py-2 font-mono text-[11px] leading-relaxed text-red-800 [overflow-wrap:anywhere]")}>{message}</pre>}
    </div>
  );
}

type Change = { path: string; kind?: string | { type?: string }; diff?: string };
function FileTree({ changes }: { changes: readonly Change[] }) {
  const relative = useRelative();
  const rows = changes.map(change => {
    const path = relative(change.path);
    const kind = typeof change.kind === "string" ? change.kind : change.kind?.type ?? "update";
    const diff = typeof change.diff === "string" ? change.diff.split("\n") : [];
    return { path, kind, added: diff.filter(l => l.startsWith("+") && !l.startsWith("+++")).length, removed: diff.filter(l => l.startsWith("-") && !l.startsWith("---")).length };
  });
  const totals = rows.reduce((t, r) => ({ added: t.added + r.added, removed: t.removed + r.removed }), { added: 0, removed: 0 });
  return (
    <div data-slot="file-tree" className={cn(paper, "flex w-full flex-col gap-2 rounded-2xl p-3.5")}>
      <div className="flex items-baseline justify-between px-1">
        <span className="text-[13.5px] font-medium">{rows.length} file{rows.length === 1 ? "" : "s"} changed</span>
        <span className={cn(mono, "tabular-nums")}><span className="text-emerald-700">+{totals.added}</span> <span className="text-red-700">−{totals.removed}</span></span>
      </div>
      <div className="flex flex-col">
        {take(rows, 40).map(row => {
          const parts = row.path.split("/");
          return (
            <div key={row.path} className="hover:bg-foreground/[0.03] flex items-center gap-2 rounded-lg px-1 py-1 text-[13px]" title={row.path}>
              {parts.length > 1 && <><FolderIcon className="text-foreground/35 size-3.5 shrink-0" /><span className="text-foreground/50 min-w-0 truncate">{parts.slice(0, -1).join("/")}</span></>}
              <FileIcon className="text-foreground/30 size-3.5 shrink-0" />
              <span className="text-foreground/85 min-w-0 flex-1 truncate">{parts.at(-1)}</span>
              <span className={cn(mono, "text-foreground/40 shrink-0")}>{row.kind}</span>
              <span className={cn(mono, "shrink-0 tabular-nums")}>{row.added ? <span className="text-emerald-700">+{row.added}</span> : null} {row.removed ? <span className="text-red-700">−{row.removed}</span> : null}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RequestResult({ request, result }: { request: ReactNode; result: ReactNode }) {
  return (
    <div className={cn(field, "overflow-hidden rounded-2xl text-xs")}>
      <div className="px-3.5 pt-2.5 pb-2"><p className={cn(mono, "text-foreground/35 mb-1")}>Request</p><div className="text-foreground/60 whitespace-pre-wrap font-mono [overflow-wrap:anywhere]">{request}</div></div>
      {result != null && result !== "" && <>
        <div className="bg-foreground/[0.06] mx-3.5 h-px" />
        <div className="px-3.5 pt-2 pb-2.5"><p className={cn(mono, "text-foreground/35 mb-1")}>Result</p><div className="text-foreground/90 max-h-60 overflow-auto whitespace-pre-wrap [overflow-wrap:anywhere]">{result}</div></div>
      </>}
    </div>
  );
}

export function CodexTool(props: ToolCallMessagePartProps) {
  const relative = useRelative();
  const state = lifecycle(props);
  // Approvals and questions from MCP tools must stay reachable inside the collapsed history.
  const openHistory = useContext(WorkHistoryControl);
  const requiresAction = props.status?.type === "requires-action";
  useEffect(() => { if (requiresAction) openHistory(true); }, [requiresAction, openHistory]);
  const args = props.args as Record<string, unknown>;
  const output = typeof props.result === "string" ? props.result
    : typeof args.aggregatedOutput === "string" ? args.aggregatedOutput
    : (props.artifact as { output?: string } | undefined)?.output ?? text(props.result);
  const itemType = props.providerMetadata?.canvasdoc?.itemType as string | undefined;
  switch (itemType ?? props.toolName) {
    case "commandExecution": case "Run command": {
      const actions = props.providerMetadata?.canvasdoc?.commandActions as { command?: string }[] | undefined;
      const command = unwrapShell(String(actions?.find(a => a.command)?.command ?? args.command ?? ""));
      const exitCode = typeof args.exitCode === "number" ? args.exitCode : undefined;
      const lines = output.replace(/\n$/, "").split("\n").filter((l, i, all) => all.length === 1 ? l !== "" : true);
      return (
        <ToolRow state={state} verb="Ran" activeVerb="Running" target={command}>
          {state === "failed"
            ? <ToolError name="Command failed" target={command} message={lines.slice(-30).join("\n") || (typeof exitCode === "number" ? `Exited with code ${exitCode}` : "")} />
            : <TerminalBlock command={command} cwd={typeof args.cwd === "string" ? relative(args.cwd) : undefined} lines={lines} state={state} exitCode={exitCode} />}
        </ToolRow>
      );
    }
    case "fileChange": case "Edit files": {
      const changes = (Array.isArray(args.files) ? args.files : Array.isArray(args.changes) ? args.changes : []) as Change[];
      const target = changes.length === 1 ? relative(changes[0].path).split("/").at(-1) : `${changes.length} files`;
      return (
        <ToolRow state={state} verb="Edited" activeVerb="Editing" target={target}>
          {state === "failed" ? <ToolError name="Edit failed" target={target} message={output} /> : <FileTree changes={changes} />}
        </ToolRow>
      );
    }
    case "webSearch": case "Search web": {
      const query = String(args.query ?? args.q ?? "");
      return <ToolRow state={state} verb="Searched" activeVerb="Searching" target={query}><RequestResult request={query} result={output} /></ToolRow>;
    }
    case "imageView": case "View image": {
      const path = typeof args.path === "string" ? relative(args.path) : "";
      return <ToolRow state={state} verb="Viewed" activeVerb="Viewing" target={path}><RequestResult request={path} result={state === "failed" ? output : ""} /></ToolRow>;
    }
    case "collabAgentToolCall": case "Delegate work": {
      const prompt = String(args.prompt ?? args.task ?? text(args));
      return <ToolRow state={state} verb="Delegated" activeVerb="Delegating" target={prompt.slice(0, 80)}><RequestResult request={prompt} result={output} /></ToolRow>;
    }
    default:
      // MCP and unknown tools keep assistant-ui's fallback, including its approval controls.
      return <ToolFallback {...props} {...(state === "interrupted" ? { status: { type: "incomplete", reason: "cancelled" } } : {})} />;
  }
}
