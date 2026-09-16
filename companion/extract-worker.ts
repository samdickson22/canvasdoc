import { readFile } from "node:fs/promises";
import path from "node:path";
import { extractDocument } from "./document-text.ts";
// Keep the worker's stdout a single machine-readable result.
console.log = (...args) => console.error(...args);
try {
  const result = await extractDocument(
    await readFile(process.argv[2]),
    path.extname(process.argv[2]).toLowerCase(),
  );
  process.stdout.write(JSON.stringify(result));
} catch (error) {
  process.stdout.write(
    JSON.stringify({
      status: "error",
      text: "",
      units: 0,
      error: error instanceof Error ? error.message : "Extraction failed.",
    }),
  );
}
