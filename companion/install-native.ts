import { mkdir, writeFile, realpath } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
const [
  rootArg,
  extensionId,
  origin = "https://mac-mini.tail39179a.ts.net:3211",
] = process.argv.slice(2);
if (!rootArg || !/^[a-p]{32}$/.test(extensionId || ""))
  throw new Error(
    "Usage: node companion/install-native.ts /path/to/Canvasdoc EXTENSION_ID [Canvas origin]",
  );
if (process.platform !== "darwin")
  throw new Error("Native registration currently supports macOS.");
const root = await realpath(rootArg);
const dir = path.join(root, ".canvasdoc");
await mkdir(dir, { recursive: true });
const quote = (s: string) => "'" + s.replaceAll("'", "'\\''") + "'";
const launcher = path.join(dir, "native-host.sh");
await writeFile(
  launcher,
  `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(path.resolve("companion/native-host.ts"))} ${quote(root)} ${quote(origin)} 3218\n`,
  { mode: 0o700 },
);
const manifest = {
  name: "com.canvasdoc.connector",
  description: "Canvasdoc local runtime connection",
  path: launcher,
  type: "stdio",
  allowed_origins: [`chrome-extension://${extensionId}/`],
};
const directory = path.join(
  os.homedir(),
  "Library/Application Support/Google/Chrome/NativeMessagingHosts",
);
await mkdir(directory, { recursive: true });
await writeFile(
  path.join(directory, manifest.name + ".json"),
  JSON.stringify(manifest, null, 2),
  { mode: 0o600 },
);
console.log(
  "Registered the Canvasdoc native host for the selected extension and folder.",
);
