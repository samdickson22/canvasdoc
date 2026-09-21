// Adapted from assistant-ui's elements-approval-card.
import type { ComponentProps, ReactNode } from "react";
import { CheckIcon, Loader2Icon, TerminalIcon, XIcon } from "lucide-react";
import { cn } from "../../../lib/utils";
import { field, ghostButton, inkButton, paper } from "./surfaces";

export type ApprovalState = "request" | "running" | "done" | "denied";

export function ApprovalCard({ state, command, title, subtitle, icon, children, onAllow, onDeny, allowLabel = "Allow", disabled, className, ...props }: Omit<ComponentProps<"section">, "title"> & {
  state: ApprovalState;
  command?: string;
  title: string;
  subtitle?: ReactNode;
  icon?: ReactNode;
  onAllow?: () => void;
  onDeny?: () => void;
  allowLabel?: string;
  disabled?: boolean;
}) {
  return (
    <section data-slot="approval-card" className={cn(paper, "flex w-full flex-col gap-3 rounded-[20px] p-4", className)} {...props}>
      <div className="flex items-center gap-3">
        <span className="bg-foreground/[0.05] text-foreground/45 flex size-9 shrink-0 items-center justify-center rounded-xl">{icon ?? <TerminalIcon className="size-4" />}</span>
        <div className="flex min-w-0 flex-col">
          <p className="text-[13.5px] font-medium">{title}</p>
          {subtitle && <p className="text-foreground/45 text-xs [overflow-wrap:anywhere]">{subtitle}</p>}
        </div>
      </div>
      {command && <pre className={cn(field, "text-foreground/70 m-0 whitespace-pre-wrap rounded-xl px-3.5 py-2.5 font-mono text-xs [overflow-wrap:anywhere]")}>{command}</pre>}
      {children}
      <div className="flex min-h-8 items-center justify-end gap-2">
        {state === "request" ? (
          <>
            {onDeny && <button type="button" onClick={onDeny} disabled={disabled} className={ghostButton}>Decline</button>}
            {onAllow && <button type="button" onClick={onAllow} disabled={disabled} className={cn(inkButton, "flex h-8 items-center rounded-full px-3.5 text-xs font-medium disabled:opacity-40")}>{allowLabel}</button>}
          </>
        ) : (
          <div className="fade-in animate-in text-foreground/55 flex items-center gap-2 text-xs duration-300">
            {state === "running" ? <><Loader2Icon className="text-foreground/45 size-3.5 animate-spin motion-reduce:animate-none" />Sending</>
              : state === "denied" ? <><XIcon className="text-foreground/45 size-3.5" />Declined</>
              : <><CheckIcon className="size-3.5 text-emerald-500" />Allowed</>}
          </div>
        )}
      </div>
    </section>
  );
}
