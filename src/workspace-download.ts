type DownloadFile = {
  path: string;
  mime: string;
  base64: string;
  previewKind?: string;
  notice?: string;
};

export async function prepareWorkspaceDownload(
  path: string,
  read: (path: string) => Promise<DownloadFile>,
) {
  const file = await read(path);
  if (file.previewKind === "unavailable")
    throw new Error(file.notice || "This file is unavailable for download.");
  return {
    name: file.path.split("/").pop()!,
    blob: new Blob([Uint8Array.from(atob(file.base64), c => c.charCodeAt(0))], { type: file.mime }),
  };
}
