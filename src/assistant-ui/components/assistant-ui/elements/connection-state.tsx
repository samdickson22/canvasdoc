// Adapted from assistant-ui's elements-connection-state with Canvasdoc's companion wording.
import type { ComponentProps } from "react";
import { CloudOffIcon, Loader2Icon } from "lucide-react";
import { cn } from "../../../lib/utils";
import { ghostButton, paper } from "./surfaces";
import { SetupCommand } from "./setup-command";

export type ConnectionPhase = "online" | "dropped" | "reconnecting";

export function ConnectionState({ phase, onRetry, className, ...props }: Omit<ComponentProps<"div">, "children"> & { phase: ConnectionPhase; onRetry?: () => void }) {
  if (phase === "online") return null;
  return (
    <div data-slot="connection-state" role="status" className={cn(paper, "fade-in slide-in-from-top-1 animate-in flex w-full items-center gap-2.5 rounded-2xl px-3.5 py-2.5 duration-300 motion-reduce:animate-none", className)} {...props}>
      {phase === "dropped" ? <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex items-center gap-2.5">
          <CloudOffIcon className="size-3.5 shrink-0 text-amber-600" />
          <span className="min-w-0 flex-1 text-[13px]">Your computer is disconnected. Messages wait here and the agent keeps any running work. To start it, run this in Terminal, then connect.</span>
          {onRetry && <button type="button" onClick={onRetry} className={cn(ghostButton, "h-7 shrink-0 px-2.5")}>Connect</button>}
        </div>
        <SetupCommand compact />
      </div> : <>
        <Loader2Icon className="text-foreground/40 size-3.5 shrink-0 animate-spin motion-reduce:animate-none" />
        <span className="min-w-0 flex-1 text-[13px]">Connecting to your computer</span>
      </>}
    </div>
  );
}
