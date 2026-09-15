import {
  empty,
  mutate,
  parseSavedData,
  type Data,
  type Mutation,
} from "./data.ts";
const extension = typeof chrome !== "undefined" && !!chrome.runtime?.id;
export const browserStorage = {
  async load(key: string): Promise<Data> {
    if (extension) {
      const result = await chrome.runtime.sendMessage({
        type: "canvasdoc:storage:load",
        key,
      });
      if (result.error) throw new Error(result.error);
      return parseSavedData(JSON.stringify(result.data));
    }
    return parseSavedData(localStorage.getItem(key));
  },
  async commit(key: string, op: Mutation): Promise<Data> {
    if (extension) {
      const result = await chrome.runtime.sendMessage({
        type: "canvasdoc:storage:commit",
        key,
        op,
      });
      if (result.error) throw new Error(result.error);
      return parseSavedData(JSON.stringify(result.data));
    }
    const commit = () => {
      const data = mutate(parseSavedData(localStorage.getItem(key)), op);
      localStorage.setItem(key, JSON.stringify(data));
      return data;
    };
    return navigator.locks ? navigator.locks.request(key, commit) : commit();
  },
  subscribe(key: string, listener: (data: Data) => void) {
    if (extension) {
      const onChanged = (
        changes: Record<string, chrome.storage.StorageChange>,
        area: string,
      ) => {
        if (area === "local" && changes[key]) {
          const value = changes[key].newValue;
          if (typeof value === "string" || value === undefined)
            listener(parseSavedData(value ?? null));
        }
      };
      chrome.storage.onChanged.addListener(onChanged);
      return () => chrome.storage.onChanged.removeListener(onChanged);
    }
    const onStorage = (event: StorageEvent) => {
      if (event.key === key) listener(parseSavedData(event.newValue));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  },
};
