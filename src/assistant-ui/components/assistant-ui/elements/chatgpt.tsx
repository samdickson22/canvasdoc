"use client";

import {
  ActionBarPrimitive,
  AuiIf,
  AttachmentPrimitive,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useAui,
  useAuiState,

} from "@assistant-ui/react";
import { type FC, type PropsWithChildren, type ReactNode, useContext, createContext, useEffect, useRef, useState } from "react";
import { TooltipIconButton } from "./tooltip-icon-button";
import { useAttachmentSrc } from "../../../hooks/use-attachment-src";
import {
  ArrowUpIcon,
  CheckIcon,
  ChevronDownIcon,
  CopyIcon,
  Mic,
  PlusIcon,
  RefreshCwIcon,
  Volume2,
  SquareIcon,
  XIcon,
} from "lucide-react";
import { MarkdownText } from "./markdown-text";
import { hasFileDrop, readDroppedFiles } from "../../../../runtime/dropped-files";
import { CodexModelSelector } from "../../../../model-selector";

import { WorkHistory, ActivityTool, RunData, RunOutcome, LiveActivity } from "./run-activity";
import { attachmentWorkspaceHref, type AttachmentUploadState } from "../../../../runtime/attachments";
import { WorkspaceLink } from "../../../../workspace-link";
import { SelectionQuote, ComposerQuote, AttachmentPreview, QueuedMessages, type QueuedMessage } from "./chat-extras";
import { finalAnswerText } from "../../../../runtime/message-presentation";
import { EmptyState as EmptyStateRoot, EmptyStateGreeting, EmptyStateSuggestion, EmptyStateSuggestions } from "./empty-state";
import { ArtifactCard } from "./artifact-card";
import type { ArtifactEvidence } from "../../../../workspace-files";

type WorkOptions = {
  preparing?: boolean;
  compact?: boolean;
  onReadAloud?: (text: string) => void;
  queuedMessages?: readonly QueuedMessage[];
  onCancelQueued?: (id: string) => Promise<void>;
  uploadStates?: Readonly<Record<string, AttachmentUploadState>>;
  composerFooter?: ReactNode;
  workMode?: boolean;
  connected?: boolean;
  onConnect?: () => void;
  suggestions?: readonly string[];
  /** Approvals, reconnect prompts, and connection notices, kept beside the composer. */
  footerSlot?: ReactNode;
};
const WorkContext = createContext<WorkOptions>({});
export const ChatGPT: FC<WorkOptions> = (options) => {
  return (
    <WorkContext.Provider value={options}>
      <ThreadPrimitive.Root
        data-work-mode={(!options.compact && options.workMode) || undefined}
        className="aui-root min-h-0 flex h-full flex-col items-stretch bg-white px-4 text-[#0d0d0d] dark:bg-black dark:text-[#ececec]"
      >
        {options.compact ? <>{options.footerSlot}<Composer placeholder="Ask Canvasdoc…" /></> : <>
        <SelectionQuote />
        <AuiIf condition={(s) => s.thread.isEmpty}>
          <EmptyState />
        </AuiIf>

        <AuiIf condition={(s) => !s.thread.isEmpty}>
          <ThreadPrimitive.Viewport className="min-h-0 flex grow flex-col gap-8 overflow-y-auto overscroll-contain pt-8">
            <ThreadPrimitive.Messages>
              {({ message }) => {
                if (message.role === "user") return <UserMessage />;
                return <AssistantMessage />;
              }}
            </ThreadPrimitive.Messages>

            <ThreadPrimitive.ViewportFooter className="sticky bottom-0 mx-auto mt-auto flex w-full max-w-3xl flex-col gap-2 overflow-visible rounded-t-3xl bg-white pb-2 dark:bg-black">
              <ThreadScrollToBottom />
              {options.footerSlot}
              {options.queuedMessages && options.onCancelQueued && <QueuedMessages items={options.queuedMessages} onCancel={options.onCancelQueued} />}
              <Composer placeholder="Ask Canvasdoc…" />
              {options.composerFooter}
              <p className="text-center text-xs text-[#5d5d5d] dark:text-[#afafaf]">
                Canvasdoc can make mistakes. Check important info.
              </p>
            </ThreadPrimitive.ViewportFooter>
          </ThreadPrimitive.Viewport>
        </AuiIf>
        </>}
      </ThreadPrimitive.Root>
    </WorkContext.Provider>
  );
};

const EmptyState: FC = () => {
  const { composerFooter, suggestions, footerSlot } = useContext(WorkContext);
  return (
    <div className="aui-chatgpt-empty flex grow flex-col items-center justify-center px-4 pb-[16vh]">
      <EmptyStateRoot className="mx-auto max-w-3xl text-[#0d0d0d] dark:text-[#ececec]">
        <EmptyStateGreeting>What should we work on?</EmptyStateGreeting>
        {footerSlot}
        <div className="flex flex-col gap-3">
          <Composer placeholder="Ask Canvasdoc…" />
          {composerFooter}
        </div>
        {!!suggestions?.length && (
          <EmptyStateSuggestions>
            {suggestions.map((prompt, index) => (
              <ThreadPrimitive.Suggestion key={prompt} prompt={prompt} send asChild>
                <EmptyStateSuggestion index={index}>{prompt}</EmptyStateSuggestion>
              </ThreadPrimitive.Suggestion>
            ))}
          </EmptyStateSuggestions>
        )}
      </EmptyStateRoot>
    </div>
  );
};

// Native drop events keep their FileList inside Canvas's shadow-root portals.
// Attachment state, validation, and upload remain owned by assistant-ui.
const ComposerDropzone: FC<PropsWithChildren> = ({ children }) => {
  const aui = useAui();
  const ref = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const [dropError, setDropError] = useState("");
  const addAttachment = useRef((file: File) => aui.composer.addAttachment(file));
  addAttachment.current = (file: File) => aui.composer.addAttachment(file);
  useEffect(() => {
    const node = ref.current!;
    let fileDrag = false;
    const inside = (event: DragEvent) => event.composedPath().includes(node);
    const over = (event: DragEvent) => {
      fileDrag ||= hasFileDrop(event.dataTransfer);
      if (!fileDrag) return;
      const isInside = inside(event);
      setDragging(isInside);
      if (!isInside) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    };
    const leave = (event: DragEvent) => {
      if (!inside(event)) return;
      if (event.relatedTarget instanceof Node && node.contains(event.relatedTarget)) return;
      setDragging(false);
    };
    const reset = () => { fileDrag = false; setDragging(false); };
    const drop = (event: DragEvent) => {
      const accepted = inside(event) && (fileDrag || hasFileDrop(event.dataTransfer));
      reset();
      if (!accepted || !event.dataTransfer) return;
      event.preventDefault();
      event.stopPropagation();
      setDropError("");
      void readDroppedFiles(event.dataTransfer).then(async files => {
        if (!files.length) throw new Error("The browser did not provide a readable file. Save the screenshot, then drop the saved file here.");
        const results = await Promise.allSettled(files.map(file => addAttachment.current(file)));
        const errors = results.filter(result => result.status === "rejected");
        if (errors.length) setDropError(errors.map(result => String(result.reason?.message ?? result.reason)).join(" · "));
      }).catch(error => setDropError(error.message));
    };
    // Capture before Canvas/page handlers; only claim events whose composed path
    // includes this composer, including through nested shadow roots.
    window.addEventListener("dragenter", over, true);
    window.addEventListener("dragover", over, true);
    window.addEventListener("dragleave", leave, true);
    window.addEventListener("drop", drop, true);
    window.addEventListener("dragend", reset, true);
    window.addEventListener("blur", reset);
    return () => {
      window.removeEventListener("dragenter", over, true);
      window.removeEventListener("dragover", over, true);
      window.removeEventListener("dragleave", leave, true);
      window.removeEventListener("drop", drop, true);
      window.removeEventListener("dragend", reset, true);
      window.removeEventListener("blur", reset);
    };
  }, []);
  return <div ref={ref} className="chat-dropzone" data-dragging={dragging || undefined}>{children}{dropError && <p role="alert" className="px-3 py-2 text-sm text-red-700">{dropError}</p>}</div>;
};

const Composer: FC<{ placeholder: string }> = ({ placeholder }) => {
  const { workMode, compact } = useContext(WorkContext);
  if (workMode && !compact)
    return (
      <ComposerDropzone>
      <ComposerPrimitive.Root className="work-composer">
          <ComposerQuote />
          <div className="work-attachments">
            <ComposerPrimitive.Attachments
              components={{ Attachment: ChatGPTAttachmentUI }}
            />
          </div>
          <ComposerPrimitive.Input
            placeholder="Ask Canvasdoc…"
            aria-label="Work with Canvasdoc"
            rows={2}
            className="work-prompt"
          />
          <div className="work-composer-toolbar">
            <ComposerPrimitive.AddAttachment asChild>
              <TooltipIconButton
                tooltip="Add photos & files"
                aria-label="Add attachment"
              >
                <PlusIcon size={19} />
              </TooltipIconButton>
            </ComposerPrimitive.AddAttachment>
            <div className="work-model-selector"><CodexModelSelector /></div>
            <ComposerPrimaryAction />
          </div>

      </ComposerPrimitive.Root>
      </ComposerDropzone>
    );
  return (
    <ComposerDropzone>
    <ComposerPrimitive.Root className="group/composer flex w-full flex-col rounded-[28px] border border-[#e5e5e5] bg-white px-2 py-2 focus-within:border-[#d0d0d0] dark:border-transparent dark:bg-[#212121] dark:focus-within:border-transparent">
      <ComposerQuote />
      <AuiIf condition={(s) => s.composer.attachments.length > 0}>
        <div className="flex flex-row flex-wrap gap-2 px-1 pt-1 pb-2">
          <ComposerPrimitive.Attachments
            components={{ Attachment: ChatGPTAttachmentUI }}
          />
        </div>
      </AuiIf>

      <div className="flex items-end gap-1">
        <ComposerPrimitive.AddAttachment asChild>
          <TooltipIconButton
            type="button"
            tooltip="Add photos & files"
            side="top"
            aria-label="Add attachment"
            className="flex size-9 shrink-0 items-center justify-center rounded-full text-[#5d5d5d] transition-colors hover:bg-black/[0.07] hover:text-[#5d5d5d] dark:text-[#cdcdcd] dark:hover:bg-white/15 dark:hover:text-[#cdcdcd]"
          >
            <PlusIcon size={20} />
          </TooltipIconButton>
        </ComposerPrimitive.AddAttachment>

        <ComposerPrimitive.Input
          autoFocus={!compact}
          aria-label={compact ? "Ask Canvasdoc" : "Message Canvasdoc"}
          placeholder={compact ? "Ask Canvasdoc…" : placeholder}
          rows={1}
          className="max-h-52 min-h-9 flex-1 resize-none bg-transparent py-1.5 pr-2 pl-1 text-base text-[#0d0d0d] outline-none placeholder:text-[#8e8e8e] dark:text-[#ececec] dark:placeholder:text-[#8e8e8e]"
        />

        <div className="flex shrink-0 items-center gap-1">
          <ComposerPrimaryAction />
        </div>
      </div>
      {!compact && <div className="flex justify-end px-2 pt-1"><CodexModelSelector /></div>}
    </ComposerPrimitive.Root>
    </ComposerDropzone>
  );
};

const ComposerPrimaryAction: FC = () => {
  return (
    <div className="flex items-center gap-1">
      <AuiIf condition={(s) => s.thread.isRunning}>
        <ComposerPrimitive.Cancel
          aria-label="Stop response"
          className="flex size-9 items-center justify-center rounded-full bg-[#0d0d0d] text-white dark:bg-white dark:text-black"
        >
          <div className="size-2.5 rounded-[2px] bg-current" />
        </ComposerPrimitive.Cancel>
      </AuiIf>

      <AuiIf
        condition={(s) => !s.thread.isRunning && s.composer.dictation != null}
      >
        <ComposerPrimitive.StopDictation
          className="flex size-9 items-center justify-center rounded-full bg-[#0d0d0d] text-white dark:bg-white dark:text-black"
          aria-label="Stop dictation"
        >
          <div className="size-2.5 animate-pulse rounded-[2px] bg-current" />
        </ComposerPrimitive.StopDictation>
      </AuiIf>

      <AuiIf
        condition={(s) =>
          s.composer.dictation == null &&
          !s.composer.isEmpty
        }
      >
        <ComposerPrimitive.Send
          aria-label="Send message"
          className="flex size-9 items-center justify-center rounded-full bg-[#0d0d0d] text-white transition-opacity disabled:opacity-30 dark:bg-white dark:text-black"
        >
          <ArrowUpIcon className="size-6" />
        </ComposerPrimitive.Send>
      </AuiIf>

      <AuiIf
        condition={(s) =>
          !s.thread.isRunning &&
          s.composer.dictation == null &&
          s.composer.isEmpty
        }
      >
        <AuiIf condition={(s) => s.thread.capabilities.dictation}>
          <ComposerPrimitive.Dictate asChild>
            <TooltipIconButton
              tooltip="Dictate"
              side="top"
              aria-label="Dictate"
              className="flex size-9 items-center justify-center rounded-full text-[#5d5d5d] transition-colors hover:bg-black/[0.07] hover:text-[#5d5d5d] dark:text-[#cdcdcd] dark:hover:bg-white/15 dark:hover:text-[#cdcdcd]"
            >
              <Mic className="size-5" />
            </TooltipIconButton>
          </ComposerPrimitive.Dictate>
        </AuiIf>
      </AuiIf>
    </div>
  );
};

const ThreadScrollToBottom: FC = () => {
  return (
    <ThreadPrimitive.ScrollToBottom asChild>
      <TooltipIconButton
        tooltip="Scroll to bottom"
        className="bg-background absolute -top-10 z-10 self-center rounded-full border p-2 disabled:invisible dark:border-white/15 dark:bg-[#2a2a2a]"
      >
        <ChevronDownIcon className="size-5" />
      </TooltipIconButton>
    </ThreadPrimitive.ScrollToBottom>
  );
};

const UserMessage: FC = () => {
  return (
    <MessagePrimitive.Root className="chat-user-message relative mx-auto flex w-full max-w-3xl flex-col items-end gap-1">
      <MessagePrimitive.Quote>{({ text }) => <blockquote className="max-w-[80%] border-l-2 border-border pl-3 text-sm text-muted-foreground whitespace-pre-wrap">{text}</blockquote>}</MessagePrimitive.Quote>
      <div className="flex flex-row flex-wrap justify-end gap-2">
        <MessagePrimitive.Attachments
          components={{ Attachment: ChatGPTAttachmentUI }}
        />
      </div>

      <div className="work-user-bubble max-w-[70%] rounded-[14px] bg-[#f0f1ec] px-4 py-2.5 leading-6 text-[#30372d] dark:bg-[#2a2a2a] dark:text-[#ececec]">
        <MessagePrimitive.Parts />
      </div>

      <div className="chat-message-actions flex items-center gap-0.5">
        <ActionBarPrimitive.Root
          hideWhenRunning
          autohide="never"
          className="chat-user-actions flex items-center"
        >
          <ActionBarPrimitive.Copy asChild>
            <TooltipIconButton
              tooltip="Copy"
              side="top"
              className={assistantActionClassName}
            >
              <AuiIf condition={(s) => s.message.isCopied}>
                <CheckIcon className="size-5" />
              </AuiIf>
              <AuiIf condition={(s) => !s.message.isCopied}>
                <CopyIcon className="size-5" />
              </AuiIf>
            </TooltipIconButton>
          </ActionBarPrimitive.Copy>
        </ActionBarPrimitive.Root>

      </div>
    </MessagePrimitive.Root>
  );
};

const assistantActionClassName =
  "flex size-8 items-center justify-center rounded-lg text-[#5d5d5d] transition-colors hover:bg-black/[0.07] hover:text-[#5d5d5d] dark:text-[#cdcdcd] dark:hover:bg-white/15 dark:hover:text-[#cdcdcd]";

const AssistantMessage: FC = () => {
  const { onReadAloud, preparing } = useContext(WorkContext);
  const spokenText = useAuiState(s => finalAnswerText(s.message.parts));
  return (
    <MessagePrimitive.Root className="relative mx-auto flex w-full max-w-3xl flex-col">
      <div className="text-[#0d0d0d] dark:text-[#ececec]">
        <MessagePrimitive.GroupedParts indicator="always" groupBy={(part) => {
          const work = "providerMetadata" in part && part.providerMetadata?.canvasdoc?.work;
          const groups: `group-${string}`[] = work ? ["group-work"] : [];
          return groups;
        }}>
          {({ part, children }) => {
            switch (part.type) {
              case "group-work": return <WorkHistory indices={part.indices}>{children}</WorkHistory>;
              case "text": return <MarkdownText />;
              case "reasoning": return null;
              case "tool-call": return part.toolUI ?? <ActivityTool {...part} />;
              case "data": return <RunData part={part} />;
              case "indicator": return <LiveActivity preparing={preparing} />;
              default: return null;
            }
          }}
        </MessagePrimitive.GroupedParts>
        <RunOutcome />
        <MessageArtifacts />
      </div>

      <div className="chat-message-actions -ml-2 flex items-center pt-1">
        <ActionBarPrimitive.Root hideWhenRunning className="flex items-center">
          <ActionBarPrimitive.Copy asChild>
            <TooltipIconButton
              tooltip="Copy"
              side="top"
              className={assistantActionClassName}
            >
              <AuiIf condition={(s) => s.message.isCopied}>
                <CheckIcon className="size-5" />
              </AuiIf>
              <AuiIf condition={(s) => !s.message.isCopied}>
                <CopyIcon className="size-5" />
              </AuiIf>
            </TooltipIconButton>
          </ActionBarPrimitive.Copy>
          <AuiIf condition={(s) => s.message.speech == null}>
          <ActionBarPrimitive.Speak asChild disabled={!spokenText || !onReadAloud} onClick={() => onReadAloud?.(spokenText)}>
            <TooltipIconButton
              tooltip="Read aloud"
              side="top"
              className={assistantActionClassName}
            >
              <Volume2 className="size-5" />
            </TooltipIconButton>
          </ActionBarPrimitive.Speak>
          </AuiIf>
          <AuiIf condition={(s) => s.message.speech != null}>
            <ActionBarPrimitive.StopSpeaking asChild>
              <TooltipIconButton tooltip="Stop reading" side="top" className={assistantActionClassName}>
                <SquareIcon className="size-5" />
              </TooltipIconButton>
            </ActionBarPrimitive.StopSpeaking>
          </AuiIf>

          <ActionBarPrimitive.Reload asChild>
            <TooltipIconButton
              tooltip="Regenerate"
              side="top"
              className={assistantActionClassName}
            >
              <RefreshCwIcon className="size-5" />
            </TooltipIconButton>
          </ActionBarPrimitive.Reload>
        </ActionBarPrimitive.Root>
      </div>
    </MessagePrimitive.Root>
  );
};

/** Files the agent delivered for this reply, as cards that open in Workspace. */
const MessageArtifacts: FC = () => {
  const custom = useAuiState(s => s.message.metadata.custom) as { files?: string[]; artifacts?: ArtifactEvidence[] };
  const running = useAuiState(s => s.message.status?.type === "running");
  const items = custom.artifacts?.length ? custom.artifacts : (custom.files ?? []).map(path => ({ path, status: "available" as const }));
  if (running || !items.length) return null;
  return (
    <div className="chat-artifacts flex flex-wrap gap-2 pt-3">
      {items.map(item => {
        const parts = item.path.split("/");
        const size = "size" in item && typeof item.size === "number" ? ` · ${item.size < 1024 ? `${item.size} B` : item.size < 1048576 ? `${Math.round(item.size / 1024)} KB` : `${(item.size / 1048576).toFixed(1)} MB`}` : "";
        return <ArtifactCard key={item.path} href={item.path} title={parts.at(-1) ?? item.path} unavailable={item.status !== "available"}
          meta={item.status === "available" ? `${parts.slice(0, -1).join("/") || "workspace"}${size}` : "Not found in the workspace"} />;
      })}
    </div>
  );
};

const ChatGPTAttachmentUI: FC = () => {
  const aui = useAui();
  const isComposer = aui.attachment.source !== "message";
  const src = useAttachmentSrc();
  const attachment = useAuiState((s) => s.attachment);
  const { uploadStates } = useContext(WorkContext);
  const uploadState = isComposer ? uploadStates?.[attachment.id] : undefined;
  const href = !isComposer ? attachmentWorkspaceHref(attachment) : undefined;
  const name = <AttachmentPrimitive.Name />;

  return (
    <AttachmentPrimitive.Root className="group/attachment relative">
      <div className="bg-secondary flex items-center gap-2 overflow-hidden rounded-2xl border dark:bg-white/5">
        <AuiIf condition={(s) => s.attachment.type === "image"}>
          {src ? (
            <AttachmentPreview src={src} name={attachment.name}><img
              className="size-32 rounded-md object-cover"
              alt={attachment.name}
              src={src}
            /></AttachmentPreview>
          ) : (
            <div className="flex h-full w-12 items-center justify-center rounded-md">
              <AttachmentPrimitive.unstable_Thumb className="text-xs" />
            </div>
          )}
        </AuiIf>
        <AuiIf condition={(s) => s.attachment.type !== "image"}>
          <div className="bg-background flex h-full w-12 items-center justify-center rounded-[9px] text-[#6b6b6b] dark:bg-[#3a3a3a] dark:text-[#9a9a9a]">
            <AttachmentPrimitive.unstable_Thumb className="text-xs" />
          </div>
        </AuiIf>
        <div className="min-w-0 py-3 pr-4 text-sm">
          {href ? (
            <WorkspaceLink href={href} className="block max-w-48 truncate underline" title={`Open ${attachment.name}`}>{name}</WorkspaceLink>
          ) : <span className="block max-w-48 truncate">{name}</span>}
          {uploadState?.type === "uploading" && <span role="status" className="block text-xs text-neutral-500">Uploading…</span>}
          {uploadState?.type === "complete" && <span role="status" className="block text-xs text-neutral-500">Uploaded</span>}
          {uploadState?.type === "error" && <span role="alert" className="block max-w-64 text-xs text-red-700">{uploadState.message}</span>}
        </div>
      </div>
      {isComposer && (
        <AttachmentPrimitive.Remove aria-label="Remove attachment" className="absolute -top-1.5 -right-1.5 flex size-7 items-center justify-center rounded-full border border-[#e5e5e5] bg-white text-[#6b6b6b] transition-all hover:bg-[#f5f5f5] hover:text-[#0d0d0d] dark:border-[#3a3a3a] dark:bg-[#1a1a1a] dark:text-[#9a9a9a] dark:hover:bg-[#252525] dark:hover:text-white">
          <XIcon className="size-5" />
        </AttachmentPrimitive.Remove>
      )}
    </AttachmentPrimitive.Root>
  );
};
