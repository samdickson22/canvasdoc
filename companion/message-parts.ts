import type {
  TextMessagePart,
  ReasoningMessagePart,
  ToolCallMessagePart,
  DataMessagePart,
} from "@assistant-ui/react";
type Mutable<T> = { -readonly [K in keyof T]: T[K] };
export type DisplayPart = Mutable<
  TextMessagePart | ReasoningMessagePart | ToolCallMessagePart | DataMessagePart
> & {
  itemId?: string;
  phase?: "commentary" | "final_answer";
};
