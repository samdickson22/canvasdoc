import { useState, type ReactNode } from "react";
import { ComposerPrimitive, SelectionToolbarPrimitive } from "@assistant-ui/react";
import { QuoteIcon, XIcon } from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "../../ui/dialog";

export function SelectionQuote() {
  // This primitive portals to document.body, outside Canvasdoc's styled shadow root.
  return <SelectionToolbarPrimitive.Root style={{ background: "#fff", color: "#26322b", border: "1px solid #dce2d8", borderRadius: 8, padding: 4, boxShadow: "0 3px 14px #0002", zIndex: 10000 }}>
    <SelectionToolbarPrimitive.Quote style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 10px", border: 0, borderRadius: 4, background: "transparent", color: "inherit", font: "13px system-ui", cursor: "pointer" }}>
      <QuoteIcon size={14} /> Quote
    </SelectionToolbarPrimitive.Quote>
  </SelectionToolbarPrimitive.Root>;
}

export function ComposerQuote() {
  return <ComposerPrimitive.Quote className="mx-3 mt-3 flex items-start gap-2 rounded-md border-l-2 border-primary bg-muted p-2 text-sm text-muted-foreground">
    <ComposerPrimitive.QuoteText className="line-clamp-3 min-w-0 flex-1 whitespace-pre-wrap" />
    <ComposerPrimitive.QuoteDismiss aria-label="Remove quote" className="shrink-0 rounded p-1 hover:bg-accent"><XIcon size={14} /></ComposerPrimitive.QuoteDismiss>
  </ComposerPrimitive.Quote>;
}

export function AttachmentPreview({ src, name, children }: { src: string; name: string; children: ReactNode }) {
  return <Dialog>
    <DialogTrigger aria-label={`Preview ${name}`} className="cursor-zoom-in rounded-md focus-visible:outline-2 focus-visible:outline-ring">{children}</DialogTrigger>
    <DialogContent className="w-[calc(100vw-2rem)] max-w-none sm:max-w-none">
      <DialogTitle className="pr-8">{name}</DialogTitle>
      <img src={src} alt={name} className="mx-auto max-h-[80vh] max-w-full object-contain" />
    </DialogContent>
  </Dialog>;
}

export type QueuedMessage = { id: string; text: string; pendingDelivery?: boolean };
export function QueuedMessages({ items, onCancel }: { items: readonly QueuedMessage[]; onCancel: (id: string) => Promise<void> }) {
  const [cancelling, setCancelling] = useState<string>();
  const [error, setError] = useState("");
  if (!items.length && !error) return null;
  return <section aria-label="Queued messages" className="mx-2 mb-2 text-xs text-muted-foreground">
    {!!items.length && <p className="mb-1">{items.length} queued</p>}
    <ul className="flex max-h-32 flex-col gap-1 overflow-y-auto">
      {items.map(item => <li key={item.id} className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2">
        <span className="min-w-0 flex-1 truncate" title={item.text}>{item.text}</span>
        {item.pendingDelivery && <span className="shrink-0">Waiting for connection</span>}
        <button type="button" aria-label={`Cancel queued message: ${item.text}`} disabled={!!cancelling} className="shrink-0 rounded p-1 hover:bg-accent disabled:opacity-50" onClick={async () => {
          setCancelling(item.id); setError("");
          try { await onCancel(item.id); } catch (error) { setError((error as Error).message); }
          finally { setCancelling(undefined); }
        }}><XIcon size={14} /></button>
      </li>)}
    </ul>
    {error && <p role="alert">{error}</p>}
  </section>;
}
