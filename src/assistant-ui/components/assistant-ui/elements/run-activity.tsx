import { useEffect, useState, type PropsWithChildren } from "react";
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
import { ToolFallback } from "./tool-fallback.aui";
import {
  formatRunDuration,
  summarizeActivity,
} from "../../../../runtime/message-presentation";
import type { DisplayPart } from "../../../../../companion/message-parts";
import type { SavedMessage } from "../../../../types";

export function LiveActivity({ hasQueuedMessages = false }: { hasQueuedMessages?: boolean }) {
  const parts = useAuiState(s => s.message.parts) as readonly DisplayPart[];
  const run = useAuiState(s => s.message.metadata.custom.run);
  if (!run && hasQueuedMessages) return null;
  const last = parts.at(-1);
  // The last activity group owns the live row once reasoning or tools arrive.
  if (last?.type === "reasoning" || last?.type === "tool-call") return null;
  const label = !run ? "Waiting for agent" : last?.type === "text" && last.providerMetadata?.canvasdoc?.work === false
    ? "Writing response"
    : summarizeActivity(parts, true);
  return <div role="status" className="chat-thinking flex items-center gap-2 text-sm text-neutral-500">
    <span className="chat-thinking-dot shrink-0" aria-hidden="true" />
    <span className="shimmer motion-reduce:animate-none">{label}</span>
  </div>;
}

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
  return (
    <ToolGroupRoot
      variant="ghost"
      className="chat-work-history"
      open={running || (expanded ?? failed)}
      onOpenChange={setExpanded}
    >
      {running ? (
        <div className="chat-run-heading" role="status">
          Working{duration ? ` for ${duration}` : "…"}
        </div>
      ) : (
        <ToolGroupTrigger count={tools.length} label={label} />
      )}
      <ToolGroupContent className="chat-work-content">
        {children}
      </ToolGroupContent>
    </ToolGroupRoot>
  );
}

export function ActivityGroup({
  children,
  indices,
  running,
}: PropsWithChildren<{ indices: readonly number[]; running: boolean }>) {
  const parts = useAuiState((s) => s.message.parts);
  const messageRunning = useAuiState((s) => s.message.status?.type === "running");
  const active = messageRunning && (running || indices.includes(parts.length - 1));
  const selected = indices
    .map((i) => parts[i])
    .filter(Boolean) as DisplayPart[];
  const hasFailure = selected.some((p) => p.type === "tool-call" && p.isError);
  const [expanded, setExpanded] = useState<boolean | undefined>();
  return (
    <ToolGroupRoot
      variant="ghost"
      className="chat-activity-group"
      open={expanded ?? hasFailure}
      onOpenChange={setExpanded}
    >
      <ToolGroupTrigger
        count={selected.length}
        active={active}
        label={summarizeActivity(selected, active)}
      />
      <ToolGroupContent className="chat-activity-content">
        {children}
      </ToolGroupContent>
    </ToolGroupRoot>
  );
}

export function ActivityTool(props: ToolCallMessagePartProps) {
  const output = (props.artifact as { output?: string } | undefined)?.output;
  return (
    <div>
      <ToolFallback
        {...props}
        {...(props.providerMetadata?.canvasdoc?.lifecycle === "interrupted"
          ? { status: { type: "incomplete", reason: "cancelled" } }
          : {})}
      />
      {output && props.result === undefined ? (
        <pre className="chat-live-output" aria-label="Live command output">
          {output}
        </pre>
      ) : null}
    </div>
  );
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
