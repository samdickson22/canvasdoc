import { materialDownload } from "./material-download";
import { mutate, parseSavedData, type Mutation } from "../src/storage/data.ts";
const queues = new Map<string, Promise<unknown>>();
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (
    sender.id !== chrome.runtime.id ||
    !sender.url ||
    !/^(https:\/\/mac-mini\.tail39179a\.ts\.net:3211|http:\/\/localhost:3210|https:\/\/canvas\.calpoly\.edu)(\/|$)/.test(
      sender.url,
    )
  )
    return;
  if (message.type === "canvasdoc:material-download") {
    void materialDownload(message, sender.url).then(result=>respond({result}),error=>respond({error:error.message}));
    return true;
  }
  if (
    !message.type?.startsWith("canvasdoc:storage:") ||
    typeof message.key !== "string" ||
    !message.key.startsWith("canvasdoc:")
  )
    return;
  const run = (queues.get(message.key) || Promise.resolve())
    .catch(() => {})
    .then(async () => {
      const result = await chrome.storage.local.get(message.key);
      const raw=result[message.key];
      if(raw!==undefined && typeof raw!=="string") throw new Error("Invalid extension storage data");
      const current = parseSavedData(raw ?? null);
      if (message.type === "canvasdoc:storage:load") return current;
      if (message.type !== "canvasdoc:storage:commit")
        throw new Error("Unknown storage operation");
      const next = mutate(current, message.op as Mutation);
      parseSavedData(JSON.stringify(next));
      await chrome.storage.local.set({ [message.key]: JSON.stringify(next) });
      return next;
    });
  queues.set(message.key, run);
  void run.then(
    (data) => respond({ data }),
    (error) => respond({ error: error.message }),
  );
  void run
    .finally(() => {
      if (queues.get(message.key) === run) queues.delete(message.key);
    })
    .catch(() => {});
  return true;
});

chrome.runtime.onConnect.addListener((port) => {
  const sender = port.sender;
  if (
    port.name !== "canvasdoc:runtime" ||
    sender?.id !== chrome.runtime.id ||
    !sender.url ||
    !/^(https:\/\/mac-mini\.tail39179a\.ts\.net:3211|http:\/\/localhost:3210|https:\/\/canvas\.calpoly\.edu)(\/|$)/.test(
      sender.url,
    )
  ) {
    port.disconnect();
    return;
  }
  const native = chrome.runtime.connectNative("com.canvasdoc.connector");
  native.onMessage.addListener((message) => port.postMessage(message));
  native.onDisconnect.addListener(() => {
    const error = chrome.runtime.lastError;
    const message = error?.message || "Local connector disconnected.";
    console.error("Canvasdoc native connection:", message);
    try { port.postMessage({ type: "native-disconnected", message }); } catch { /* The Canvas tab already closed. */ }
  });
  port.onMessage.addListener((message) => {
    const prefix = `canvasdoc:v1:${new URL(sender.url!).origin}:`;
    if (typeof message.account !== "string" || !message.account.startsWith(prefix) || !message.account.slice(prefix.length) || message.account.slice(prefix.length).includes(":")) {
      port.postMessage({ type: "error", code: "account_mismatch", message: "Canvas account does not match this tab." });
      port.disconnect();
      native.disconnect();
      return;
    }
    native.postMessage(message);
  });
  port.onDisconnect.addListener(() => native.disconnect());
});
