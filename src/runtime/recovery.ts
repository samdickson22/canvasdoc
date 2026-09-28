/** Companion start failures name their remedy as "run: npx canvasdoc-cli …" so the panel can offer it to copy. */
export function commandFromError(message: string | undefined): string | undefined {
  const match = /run:\s*(npx canvasdoc-cli[^\n]*)$/i.exec(message ?? "");
  return match?.[1]?.trim();
}

/** The human part of a failure, without the trailing command. */
export function explanationFromError(message: string | undefined): string | undefined {
  if (!message) return undefined;
  const index = message.toLowerCase().lastIndexOf("run:");
  return commandFromError(message) && index >= 0 ? message.slice(0, index).trim() : message;
}
