// Terminal commands that install and start the local companion for this Canvas site.
import { useState } from "react";
import { CheckIcon, CopyIcon } from "lucide-react";
import { cn } from "../../../lib/utils";
import { field, mono } from "./surfaces";

const installer = "https://canvasdoc-public.vercel.app/install.sh";

export function setupCommands(origin: string, windows = false) {
  return {
    // Installs Node.js if needed; canvasdoc-cli brings Codex and runs its sign-in.
    full: windows ? `npx.cmd canvasdoc-cli@latest --origin ${origin}` : `curl -fsSL ${installer} | bash -s -- --origin ${origin}`,
    npx: `npx canvasdoc-cli@latest --origin ${origin}`,
  };
}

function useCopy() {
  const [copied, setCopied] = useState(false);
  return {
    copied,
    copy: (text: string) =>
      navigator.clipboard?.writeText(text).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      }, () => {}),
  };
}

export function SetupCommand({ compact = false }: { compact?: boolean }) {
  const windows = /Windows/i.test(navigator.userAgent);
  const { full, npx } = setupCommands(location.origin, windows);
  const main = useCopy();
  const alternative = useCopy();
  return (
    <div data-slot="setup-command" className="flex min-w-0 flex-col gap-1.5">
      {!compact && <p className="m-0 text-[13px]">{windows ? "Install Node.js 24 LTS, then paste this in PowerShell. Keep that window open while using Canvasdoc, then sign in to Codex here." : "Paste this in Terminal on your Mac once. It installs what Canvasdoc needs and starts it in the background; you can close the window when it finishes, then sign in to Codex here."}</p>}
      <div className={cn(field, "flex min-w-0 items-center gap-2 rounded-lg py-1.5 pl-2.5 pr-1")}>
        <code className={cn(mono, "min-w-0 flex-1 truncate")} title={full}>{full}</code>
        <button type="button" onClick={() => main.copy(full)} aria-label="Copy setup command" title="Copy setup command"
          className="text-foreground/55 hover:bg-foreground/[0.06] hover:text-foreground/90 flex size-7 shrink-0 items-center justify-center rounded-md">
          {main.copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
        </button>
      </div>
      {!windows && <p className="text-foreground/60 m-0 text-xs">
        Already have Node.js 22.13 or later?{" "}
        <button type="button" onClick={() => alternative.copy(npx)} title={npx} className="text-foreground/80 underline underline-offset-2">
          {alternative.copied ? "Copied" : "Copy the npx command"}
        </button>
      </p>}
    </div>
  );
}
