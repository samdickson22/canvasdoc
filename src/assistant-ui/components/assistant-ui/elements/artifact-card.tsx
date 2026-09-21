// Adapted from assistant-ui's elements-artifact-card.
import type { ComponentProps } from "react";
import { ArrowUpRightIcon, FileTextIcon, ImageIcon, FileCodeIcon, FileIcon } from "lucide-react";
import { cn } from "../../../lib/utils";
import { mono, paper } from "./surfaces";
import { WorkspaceLink } from "../../../../workspace-link";

const iconFor = (name: string) =>
  /\.(png|jpe?g|gif|webp|svg)$/i.test(name) ? ImageIcon
  : /\.(md|markdown|txt|pdf|docx?)$/i.test(name) ? FileTextIcon
  : /\.(html?|css|js|ts|tsx|py|java|sql|mmd|json)$/i.test(name) ? FileCodeIcon
  : FileIcon;

export function ArtifactCard({ title, meta, unavailable, className, ...props }: Omit<ComponentProps<"a">, "title"> & { title: string; meta: string; unavailable?: boolean }) {
  const Icon = iconFor(title);
  return (
    <WorkspaceLink data-slot="artifact-card" aria-disabled={unavailable || undefined}
      className={cn(paper, "group flex w-full max-w-xs cursor-pointer items-center gap-3 rounded-[20px] p-3 text-inherit no-underline transition-transform duration-150 hover:-translate-y-px active:scale-[0.98] motion-reduce:transition-none", unavailable && "opacity-60", className)}
      {...props}>
      <span className="bg-foreground/[0.05] text-foreground/45 flex size-9 shrink-0 items-center justify-center rounded-xl"><Icon className="size-4" /></span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13.5px] font-medium">{title}</span>
        <span className={cn(mono, "text-foreground/40 block truncate")}>{meta}</span>
      </span>
      <ArrowUpRightIcon className="text-foreground/35 size-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
    </WorkspaceLink>
  );
}
