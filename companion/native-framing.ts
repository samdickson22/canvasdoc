// Chrome limits host-to-browser messages. Split the serialized JSON so escaping,
// Unicode, and aggregate connection snapshots cannot exceed that limit.
const frameLimit = 900_000;
const chunkCharacters = 100_000;

export function* nativeFrames(value: unknown): Generator<string> {
  const json = JSON.stringify(value);
  if (new TextEncoder().encode(json).length <= frameLimit) {
    yield json;
    return;
  }
  const id = crypto.randomUUID();
  const count = Math.ceil(json.length / chunkCharacters);
  for (let index = 0; index < count; index++) {
    yield JSON.stringify({ type: "canvasdoc:native-chunk", id, index, count,
      data: json.slice(index * chunkCharacters, (index + 1) * chunkCharacters) });
  }
}

// One receiver per native port. Frames for a value are contiguous and ordered.
export function nativeReceiver() {
  let pending: { id: string; count: number; chunks: string[] } | undefined;
  return (frame: any): { value: unknown } | undefined => {
    if (frame?.type !== "canvasdoc:native-chunk") {
      if (pending) throw new Error("Native response ended before all chunks arrived.");
      return { value: frame };
    }
    if (typeof frame.id !== "string" || !Number.isSafeInteger(frame.count) || frame.count < 1 ||
        !Number.isSafeInteger(frame.index) || frame.index < 0 || frame.index >= frame.count ||
        typeof frame.data !== "string" || frame.data.length > chunkCharacters) {
      throw new Error("Invalid native response chunk.");
    }
    if (!pending && frame.index === 0) pending = { id: frame.id, count: frame.count, chunks: [] };
    if (!pending || pending.id !== frame.id || pending.count !== frame.count || pending.chunks.length !== frame.index) {
      throw new Error("Native response chunks arrived out of order.");
    }
    pending.chunks.push(frame.data);
    if (pending.chunks.length !== pending.count) return;
    const json = pending.chunks.join("");
    pending = undefined;
    return { value: JSON.parse(json) };
  };
}
