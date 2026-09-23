// Capture file references synchronously: browsers protect drag data after drop returns.
export function readDroppedFiles(transfer: DataTransfer): Promise<File[]> {
  const direct = Array.from(transfer.files);
  const pending = Array.from(transfer.items ?? [])
    .filter((item) => item.kind === "file")
    .map((item) => {
      const file = item.getAsFile();
      if (file) return Promise.resolve(file);
      const entry = item.webkitGetAsEntry?.();
      if (entry?.isFile)
        return new Promise<File>((resolve, reject) =>
          (entry as FileSystemFileEntry).file(resolve, reject),
        );
      return Promise.resolve(null);
    });
  return Promise.all(pending).then((items) => {
    const unique = new Map<string, File>();
    for (const file of [...direct, ...items]) {
      if (file)
        unique.set(`${file.name}\0${file.size}\0${file.lastModified}`, file);
    }
    return [...unique.values()];
  });
}

export function hasFileDrop(transfer: DataTransfer | null): boolean {
  return (
    !!transfer &&
    (Array.from(transfer.types).includes("Files") ||
      Array.from(transfer.items ?? []).some((item) => item.kind === "file") ||
      transfer.files.length > 0)
  );
}
