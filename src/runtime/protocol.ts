export type UserCommand = {
  model?: string;
  effort?: string;
  attachments?: import("@assistant-ui/react").CompleteAttachment[];
  requestId: string;
  sourceThreadId: string;
  title: string;
  href: string;
  text: string;
  context?: string;
};
