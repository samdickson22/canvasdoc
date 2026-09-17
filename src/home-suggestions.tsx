import { SuggestionPrimitive, ThreadPrimitive } from "@assistant-ui/react";
import type { Data } from "./storage/data";

export const catchUpPrompt = "Catch me up on what's changed in Canvas and what needs my attention.";
export function homeSuggestions(data: Data) {
  const recent = Object.values(data.threads)
    .filter(thread => thread.id !== "home" && (thread.messages.length || thread.draft.trim()))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 3);
  return [
    { title: "Catch me up", label: "Changes and upcoming work", prompt: catchUpPrompt, href: undefined as string | undefined },
    ...recent.map(thread => ({
      title: thread.title,
      label: "Continue where you left off",
      prompt: `Continue working on ${thread.title} (${thread.id})`,
      href: thread.href,
    })),
  ];
}

export function HomeSuggestions({ items }: { items: ReturnType<typeof homeSuggestions> }) {
  return <div className="home-suggestions" aria-label="Suggested next steps">
    <ThreadPrimitive.Suggestions>{({ suggestion }) => {
      const href = items.find(item => item.prompt === suggestion.prompt)?.href;
      const content = <><SuggestionPrimitive.Title /><SuggestionPrimitive.Description /></>;
      // Recent work opens the existing assignment/task conversation.
      return href
        ? <a className="home-suggestion" href={href}>{content}</a>
        : <SuggestionPrimitive.Trigger className="home-suggestion">{content}</SuggestionPrimitive.Trigger>;
    }}</ThreadPrimitive.Suggestions>
  </div>;
}
