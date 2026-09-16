export const HARNESS_PROTOCOL = {
  name: "harness-sdk",
  version: "2026-09-13",
  minVersion: "2026-09-13",
} as const;

export const INTEREST_PROTOCOL = "harness-sdk/interest";
export const CONTEXT_PROTOCOL = "harness-sdk/context";
export const MAIN_NS = "main";
export const DEFAULT_WINDOW = 50;

/** The head window of the main thread: every attach starts with it. */
export const headRequest = (window: number) => ({
  ns: MAIN_NS,
  before: window,
  follow: { before: window },
});
