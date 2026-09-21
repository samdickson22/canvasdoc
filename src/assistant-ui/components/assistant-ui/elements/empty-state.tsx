// Adapted from assistant-ui's elements-empty-state. The real composer is passed in as a child.
import type { ComponentProps } from "react";
import { cn } from "../../../lib/utils";
import { paper } from "./surfaces";

export function EmptyState({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="empty-state" className={cn("flex w-full flex-col items-stretch gap-5", className)} {...props} />;
}
export function EmptyStateGreeting({ className, ...props }: ComponentProps<"h1">) {
  return <h1 data-slot="empty-state-greeting" className={cn("fade-in slide-in-from-bottom-1 animate-in fill-mode-both text-center text-2xl font-normal leading-7 tracking-tight duration-500 motion-reduce:animate-none", className)} {...props} />;
}
export function EmptyStateSuggestions({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="empty-state-suggestions" className={cn("flex flex-wrap justify-center gap-2", className)} {...props} />;
}
export function EmptyStateSuggestion({ index = 0, className, style, ...props }: ComponentProps<"button"> & { index?: number }) {
  return (
    <button type="button" data-slot="empty-state-suggestion" style={{ animationDelay: `${120 + index * 70}ms`, ...style }}
      className={cn(paper, "fade-in slide-in-from-bottom-2 animate-in fill-mode-both text-foreground/80 hover:text-foreground focus-visible:ring-foreground/20 rounded-full px-4 py-2 text-[13px] transition-transform duration-500 outline-none hover:-translate-y-px active:scale-[0.96] motion-reduce:animate-none", className)}
      {...props} />
  );
}
