// Shared surface tokens from assistant-ui's elements registry, trimmed to what Canvasdoc uses.
import { useLayoutEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { cn } from "../../../lib/utils";

export const paper = "bg-background border border-border/60";
export const field = "bg-foreground/[0.04]";
export const inkButton = "bg-foreground text-background transition-[opacity,scale] duration-150 hover:opacity-90 active:scale-[0.96] motion-reduce:transition-none";
export const ghostButton = "text-foreground/55 hover:bg-foreground/[0.06] hover:text-foreground/90 h-8 rounded-full px-3.5 text-xs font-medium transition-[background-color,color,scale] duration-150 active:scale-[0.96] disabled:pointer-events-none disabled:opacity-40";
export const mono = "font-mono text-[11px] tracking-tight";
export const chip = "bg-foreground/[0.06] text-foreground/70 rounded-md px-1.5 py-0.5 font-mono text-[11px] min-w-0 truncate";
export const collapsePanel = "h-(--collapsible-panel-height) overflow-hidden transition-[height] duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] data-[ending-style]:h-0 data-[starting-style]:h-0 motion-reduce:transition-none";
export const take = <T,>(items: readonly T[], count: number) => items.slice(0, Math.max(0, Math.min(items.length, Math.floor(count))));

export function ShimmerLabel({ active = true, className, ...props }: ComponentProps<"span"> & { active?: boolean }) {
  return <span className={cn(active && "shimmer motion-reduce:animate-none", className)} {...props} />;
}

export function SwapLabel({ active, children, className }: { active: 0 | 1; children: [ReactNode, ReactNode]; className?: string }) {
  const layers = [useRef<HTMLSpanElement>(null), useRef<HTMLSpanElement>(null)];
  const [width, setWidth] = useState<number | null>(null);
  useLayoutEffect(() => {
    const target = layers[active]?.current;
    if (!target) return undefined;
    const measure = () => setWidth(Math.ceil(target.getBoundingClientRect().width));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(target);
    return () => observer.disconnect();
  }, [active]);
  return (
    <span style={width === null ? undefined : { width }} className={cn("grid overflow-x-clip transition-[width] duration-300 motion-reduce:transition-none", className)}>
      {children.map((layer, index) => (
        <span key={index} ref={layers[index]} aria-hidden={active !== index}
          className={cn("col-start-1 row-start-1 flex w-max items-center gap-1.5 leading-none transition-[opacity,filter] duration-300 motion-reduce:transition-none",
            active === index ? "opacity-100 blur-none" : "pointer-events-none select-none opacity-0 blur-[2px]")}>
          {layer}
        </span>
      ))}
    </span>
  );
}
