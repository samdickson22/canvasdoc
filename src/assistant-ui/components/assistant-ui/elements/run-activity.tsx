import { createContext, useEffect, useState, type PropsWithChildren } from "react";
import {
  useAuiState,
  type DataMessagePart,
  type ToolCallMessagePartProps,
} from "@assistant-ui/react";
import {
  ToolGroupRoot,
  ToolGroupTrigger,
  ToolGroupContent,
} from "./tool-group.aui";
import { CodexTool } from "./canvasdoc-tools";
import {
  formatRunDuration,
  summarizeActivity,
} from "../../../../runtime/message-presentation";
import type { DisplayPart } from "../../../../../companion/message-parts";
import type { SavedMessage } from "../../../../types";

export function LiveActivity({ hasQueuedMessages = false, preparing = false }: { hasQueuedMessages?: boolean; preparing?: boolean }) {
  const parts = useAuiState(s => s.message.parts) as readonly DisplayPart[];
  const run = useAuiState(s => s.message.metadata.custom.run);
  if (!run && hasQueuedMessages) return null;
  const last = parts.at(-1);
  // WorkHistory owns the status while a work group is present.
  if (parts.some(part => "providerMetadata" in part && part.providerMetadata?.canvasdoc?.work)) return null;
  const label = !run ? preparing ? "Preparing message" : "Starting agent" : last?.type === "text" && last.providerMetadata?.canvasdoc?.work === false
    ? "Writing response"
    : summarizeActivity(parts, true);
  return <div role="status" className="chat-thinking flex items-center gap-2 text-sm text-neutral-500">
    <span className="chat-thinking-dot shrink-0" aria-hidden="true" />
    <span className="shimmer motion-reduce:animate-none">{label}</span>
  </div>;
}

/** Lets a tool that needs a decision open its collapsed work history. */
export const WorkHistoryControl = createContext<(open: boolean) => void>(() => {});

export function WorkHistory({
  children,
  indices,
}: PropsWithChildren<{ indices: readonly number[] }>) {
  const message = useAuiState((s) => s.message);
  const running = message.status?.type === "running";
  const run = message.metadata.custom.run as SavedMessage["run"];
  const failed =
    run?.status === "error" ||
    run?.status === "interrupted" ||
    run?.status === "cancelled";
  const [expanded, setExpanded] = useState<boolean | undefined>();
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);
  const start = new Date(run?.startedAt || message.createdAt).getTime();
  const end = run?.completedAt
    ? new Date(run.completedAt).getTime()
    : running
      ? now
      : NaN;
  const duration = Number.isFinite(end - start)
    ? formatRunDuration(end - start)
    : undefined;
  const parts = indices
    .map((i) => message.parts[i])
    .filter(Boolean) as DisplayPart[];
  const tools = parts.filter((p) => p.type === "tool-call");
  const outcome =
    run?.status === "error" ? "Failed" : failed ? "Stopped" : "Worked";
  const label = `${outcome}${duration ? ` ${failed ? "after" : "for"} ${duration}` : ""}${tools.length ? ` · ${summarizeActivity(tools)}` : ""}`;
  return <>
    {running && <div className="chat-run-heading">Working{duration ? ` for ${duration}` : "…"}</div>}
    <ToolGroupRoot
      variant="ghost"
      className="chat-work-history"
      open={expanded ?? false}
      onOpenChange={setExpanded}
    >
      <ToolGroupTrigger count={tools.length} active={running}
        label={running ? summarizeActivity(message.parts as readonly DisplayPart[], true) : label} />
      <ToolGroupContent className="chat-work-content">
        <WorkHistoryControl.Provider value={setExpanded}>{children}</WorkHistoryControl.Provider>
      </ToolGroupContent>
    </ToolGroupRoot>
  </>;
}

export function ActivityTool(props: ToolCallMessagePartProps) {
  return <CodexTool {...props} />;
}

export function RunOutcome() {
  const run = useAuiState(
    (s) => s.message.metadata.custom.run,
  ) as SavedMessage["run"];
  if (run?.error)
    return (
      <p className="chat-run-error" role="alert">
        {run.error}
      </p>
    );
  if (run?.status === "interrupted" || run?.status === "cancelled")
    return (
      <p className="chat-run-note" role="status">
        Response stopped. You can continue from here.
      </p>
    );
  return null;
}

export function RunData({ part }: { part: DataMessagePart }) {
  if (part.name === "canvasdoc-compaction")
    return (
      <p className="chat-run-note">
        {part.data?.completed ? "Context compacted" : "Compacting context…"}
      </p>
    );
  if (part.name !== "canvasdoc-plan") return null;
  const steps = Array.isArray(part.data?.steps)
    ? (part.data.steps as { step: string; status: string }[])
    : [];
  return (
    <div className="chat-run-plan" aria-label="Plan">
      {part.data?.explanation ? <p>{part.data.explanation}</p> : null}
      <ol>
        {steps.map((step, index) => (
          <li key={index} data-status={step.status}>
            <span
              aria-label={
                step.status === "completed"
                  ? "Completed"
                  : step.status === "inProgress"
                    ? "In progress"
                    : "Pending"
              }
            >
              {step.status === "completed"
                ? "✓"
                : step.status === "inProgress"
                  ? "◉"
                  : "○"}
            </span>{" "}
            {step.step}
          </li>
        ))}
      </ol>
    </div>
  );
}
