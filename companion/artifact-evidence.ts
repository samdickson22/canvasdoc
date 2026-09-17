import { inspectWorkspaceFile } from "./files.ts";
import { isSyncedSource, localFilePath, markdownFileLinks, type ArtifactEvidence } from "../src/workspace-files.ts";

// Evidence describes files at delivery time, not their content quality or submission.
export async function verifyArtifacts(root: string, text: string, changed: string[]): Promise<ArtifactEvidence[]> {
  const candidates = [
    ...changed.map(path => ({ path, literal: true })),
    ...markdownFileLinks(text).map(path => ({ path, literal: false })),
  ];
  const checkedAt = new Date().toISOString();
  const evidence = new Map<string, ArtifactEvidence>();
  for (const candidate of candidates) {
    const relative = localFilePath(candidate.path, root, candidate.literal);
    if (relative && isSyncedSource(relative)) continue;
    const path = relative ?? candidate.path;
    if (evidence.has(path)) continue;
    try {
      if (!relative) throw new Error("Path is outside the accessible Canvasdoc folder.");
      const file = await inspectWorkspaceFile(root, relative);
      evidence.set(path, { path, status: "available", checkedAt, ...file });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      const reason = code === "ENOENT" || code === "ENOTDIR"
        ? "File does not exist."
        : code ? "File could not be checked." : (error as Error).message;
      evidence.set(path, { path, status: "unavailable", checkedAt, reason });
    }
  }
  return [...evidence.values()];
}
