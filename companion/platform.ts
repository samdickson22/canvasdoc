import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

export const supportDirectory = () => process.env.CANVASDOC_SUPPORT_DIR || (
  process.platform === "win32"
    ? path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "Canvasdoc")
    : path.join(os.homedir(), "Library/Application Support/Canvasdoc")
);

/** Pass URLs as arguments, without interpreting them as shell commands. */
export function openBrowser(url: string, onError: () => void = () => {}) {
  const command = process.platform === "win32" ? "explorer.exe" : process.platform === "darwin" ? "open" : "xdg-open";
  spawn(command, [url], { stdio: "ignore", windowsHide: true }).on("error", onError);
}
