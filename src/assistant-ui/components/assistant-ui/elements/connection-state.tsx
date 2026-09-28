// Adapted from assistant-ui's elements-connection-state with Canvasdoc's companion wording.
import { useState, type ComponentProps } from "react";
import { CheckIcon, CloudOffIcon, CopyIcon, CreditCardIcon, KeyRoundIcon, Loader2Icon, RefreshCwIcon } from "lucide-react";
import { cn } from "../../../lib/utils";
import { field, ghostButton, mono, paper } from "./surfaces";
import { SetupCommand } from "./setup-command";
import { companionOutdated, signIn, useConnection } from "../../../../runtime/client";
import { planStatus, STUDENT_CREDITS_URL, STUDENT_PLUS_URL } from "../../../../runtime/plan";
import { commandFromError, explanationFromError } from "../../../../runtime/recovery";

export type ConnectionPhase = "online" | "dropped" | "reconnecting";

const card = "fade-in slide-in-from-top-1 animate-in flex w-full flex-col gap-2 rounded-2xl px-3.5 py-2.5 duration-300 motion-reduce:animate-none";

/** Sign-in card shown while the companion is reachable but its Codex home has no account. */
export function SignInState({ className, ...props }: Omit<ComponentProps<"div">, "children">) {
  const state = useConnection();
  const start = () => { try { signIn(); } catch { /* The connection banner explains the drop. */ } };
  return (
    <div data-slot="sign-in-state" role="status" className={cn(paper, card, className)} {...props}>
      <div className="flex items-center gap-2.5">
        <KeyRoundIcon className="size-3.5 shrink-0 text-amber-600" />
        <span className="min-w-0 flex-1 text-[13px]">Your computer is connected. Sign in to Codex once to start the agent. The sign-in page opens in your browser.</span>
        <button type="button" onClick={start} className={cn(ghostButton, "h-7 shrink-0 px-2.5")}>Sign in</button>
      </div>
      {state.signInUrl && <p className="text-foreground/60 m-0 text-xs">If nothing opened, <a href={state.signInUrl} target="_blank" rel="noreferrer" className="text-foreground/80 underline underline-offset-2">open the sign-in page</a>, then return here.</p>}
      {state.signInError && <p className="m-0 text-xs text-red-600">{state.signInError}</p>}
    </div>
  );
}

/** Warns right after sign-in when the ChatGPT tier cannot run Codex, instead of after the first message fails. */
export function PlanNotice({ className, ...props }: Omit<ComponentProps<"div">, "children">) {
  const state = useConnection();
  const status = planStatus(state.codexPlan, state.usageAllowed);
  if (status.kind === "ok") return null;
  const link = (href: string, label: string) => <a href={href} target="_blank" rel="noreferrer" className="text-foreground/80 underline underline-offset-2">{label}</a>;
  return (
    <div data-slot="plan-notice" role="status" className={cn(paper, card, className)} {...props}>
      <div className="flex items-start gap-2.5">
        <CreditCardIcon className="mt-0.5 size-3.5 shrink-0 text-amber-600" />
        <span className="min-w-0 flex-1 text-[13px]">
          {status.kind === "needs-plan"
            ? <>This ChatGPT account is on the {status.plan === "go" ? "Go" : "Free"} tier, which does not include Codex. Students get {link(STUDENT_PLUS_URL, "four months of Plus free")} and {link(STUDENT_CREDITS_URL, "$100 in Codex credits")}. Claim one, then sign in again here.</>
            : <>Codex usage on this account is paused right now, usually because a limit was reached. Check your plan in ChatGPT, or claim {link(STUDENT_CREDITS_URL, "student credits")}.</>}
        </span>
      </div>
    </div>
  );
}

function CopyField({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className={cn(field, "flex min-w-0 items-center gap-2 rounded-lg py-1.5 pl-2.5 pr-1")}>
      <code className={cn(mono, "min-w-0 flex-1 truncate")} title={value}>{value}</code>
      <button type="button" aria-label="Copy command" title="Copy command"
        onClick={() => navigator.clipboard?.writeText(value).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1600); }, () => {})}
        className="text-foreground/55 hover:bg-foreground/[0.06] hover:text-foreground/90 flex size-7 shrink-0 items-center justify-center rounded-md">
        {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
      </button>
    </div>
  );
}

export function ConnectionState({ phase, onRetry, className, ...props }: Omit<ComponentProps<"div">, "children"> & { phase: ConnectionPhase; onRetry?: () => void }) {
  const state = useConnection();
  if (phase === "online") {
    if (state.signedIn === false) return <SignInState className={className} {...props} />;
    if (planStatus(state.codexPlan, state.usageAllowed).kind !== "ok") return <PlanNotice className={className} {...props} />;
    if (companionOutdated()) return (
      <div data-slot="connection-state" role="status" className={cn(paper, "flex w-full flex-col gap-2 rounded-2xl px-3.5 py-2.5", className)} {...props}>
        <div className="flex items-center gap-2.5">
          <RefreshCwIcon className="size-3.5 shrink-0 text-amber-600" />
          <span className="min-w-0 flex-1 text-[13px]">Your computer is running an older Canvasdoc. Paste the setup command again to update it.</span>
        </div>
        <SetupCommand compact />
      </div>
    );
    return null;
  }
  if (phase === "reconnecting") return (
    <div data-slot="connection-state" role="status" className={cn(paper, "fade-in slide-in-from-top-1 animate-in flex w-full items-center gap-2.5 rounded-2xl px-3.5 py-2.5 duration-300 motion-reduce:animate-none", className)} {...props}>
      <Loader2Icon className="text-foreground/40 size-3.5 shrink-0 animate-spin motion-reduce:animate-none" />
      <span className="min-w-0 flex-1 text-[13px]">Connecting to your computer</span>
    </div>
  );
  // Dropped: the companion's own explanation comes first, with its remedy as a copyable command when it names one.
  const failure = state.error?.startsWith("Canvasdoc could not start: ") ? state.error.slice("Canvasdoc could not start: ".length) : undefined;
  const command = commandFromError(failure);
  const explanation = explanationFromError(failure);
  return (
    <div data-slot="connection-state" role="status" className={cn(paper, card, className)} {...props}>
      <div className="flex items-center gap-2.5">
        <CloudOffIcon className="size-3.5 shrink-0 text-amber-600" />
        <span className="min-w-0 flex-1 text-[13px]">
          {explanation
            ? <>Canvasdoc could not start on your computer: {explanation}{command ? " Run this in Terminal, then connect again." : " Fix that, then connect again."}</>
            : <>Your computer is disconnected. Messages wait here and the agent keeps any running work. If Canvasdoc is not set up yet, paste this in Terminal once.</>}
        </span>
        {onRetry && <button type="button" onClick={onRetry} className={cn(ghostButton, "h-7 shrink-0 px-2.5")}>Connect</button>}
      </div>
      {command ? <CopyField value={command} /> : explanation ? null : <SetupCommand compact />}
    </div>
  );
}
