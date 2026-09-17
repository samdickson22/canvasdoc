import { createRoot } from "react-dom/client";
import { App, type Mounts } from "./app";
import { pageContext } from "./model";
import { initializeStore, store } from "./store";
import styles from "./styles.css";
import assistantStyles from "../dist/assistant-ui.css";
import hostStyles from "./host.css";
import { initializeConnection } from "./runtime/client";
import { startMaterialSync } from "./material-sync";
import { preferences } from "./preferences";

declare global {
  interface Window {
    __canvasdoc?: { dispose: () => void };
    ENV?: { current_user_id?: string | number };
  }
}

async function mount() {
  if (!location.pathname.startsWith("/login") && !document.querySelector("#content")) {
    await new Promise<void>(resolve => {
      const observer = new MutationObserver(() => {
        if (document.querySelector("#application #content")) { observer.disconnect(); clearTimeout(timeout); resolve(); }
      });
      const timeout = setTimeout(() => { observer.disconnect(); resolve(); }, 10000);
      observer.observe(document.documentElement, {childList:true,subtree:true});
    });
  }
  if (
    window.__canvasdoc ||
    document.querySelector("#canvasdoc-sidebar") ||
    !document.querySelector("#application") ||
    !document.querySelector("#content") ||
    location.pathname.startsWith("/login")
  )
    return;
  // /users/self works in the extension's isolated world as well as the dev loader.
  let profile: {id?: string | number; time_zone?: string} = {id: window.ENV?.current_user_id};
  if (!profile.id) {
    // Canvas embeds the current user in ENV even in the extension's isolated world.
    for (const script of document.scripts) {
      if (!script.textContent?.includes('ENV')) continue;
      const id = script.textContent.match(/"current_user_id"\s*:\s*"?(\d+)"?/);
      if (id) { profile.id = id[1]; break; }
    }
  }
  if (!profile.id) {
  const response = await fetch("/api/v1/users/self/profile", {
    credentials: "same-origin",
  });
  if (!response.ok) throw new Error("Canvas session is unavailable.");
  profile = await response.json();
  }
  if (!profile.id) return;
  if (!profile.time_zone) {
    void fetch("/api/v1/users/self/profile", {credentials:"same-origin"})
      .then(response => response.ok ? response.json() : null)
      .then(fresh => { if (fresh?.id && String(fresh.id) === String(profile.id) && typeof fresh.time_zone === "string") preferences.timeZone = fresh.time_zone; })
      .catch(() => {});
  }
  if (typeof profile.time_zone === "string")
    preferences.timeZone = profile.time_zone;
  await initializeStore(String(profile.id));
  initializeConnection();
  startDevRefresh();
  const content = document.querySelector<HTMLElement>("#content")!;
  const context = pageContext(
    location.pathname,
    location.search,
    content.querySelector("h1")?.textContent?.trim() || document.title,
    store.get().tasks,
  );
  const stopMaterials = startMaterialSync(context.kind === "assignment" ? context.courseId : undefined);
  const sheet = document.createElement("style");
  sheet.textContent = hostStyles;
  sheet.id = "canvasdoc-host-styles";
  document.head.append(sheet);
  const hosts: HTMLElement[] = [];
  function region(id: string, parent: HTMLElement, prepend = false) {
    const host = document.createElement("div");
    host.id = id;
    const shadow = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = `@layer theme, base, canvasdoc, components, utilities; @layer canvasdoc { ${styles} } ${assistantStyles}`;
    const container = document.createElement("div");
    shadow.append(style, container);
    if (prepend) parent.prepend(host);
    else parent.append(host);
    hosts.push(host);
    return { host, container };
  }
  const navigation = region("canvasdoc-navigation", document.body);
  const conversation = context.kind !== "home" ? region("canvasdoc-conversation", document.body) : null;
  // Keep the persistent portal out of the page until a conversation view opens.
  if (conversation) conversation.host.style.cssText = "display:none;flex:1;min-height:0;height:100%;width:100%";
  if (conversation) conversation.container.style.cssText = "display:flex;flex-direction:column;flex:1;min-height:0;height:100%;width:100%";
  const sidebar = region("canvasdoc-sidebar", document.body);
  const isHome = context.kind === "home" || context.kind === "personal";
  const main = isHome ? region("canvasdoc-main", content) : null;
  const original =
    context.kind === "assignment"
      ? Array.from(content.children).filter(
          (element): element is HTMLElement => element instanceof HTMLElement,
        )
      : [];
  const tabs =
    context.kind === "assignment"
      ? region("canvasdoc-tabs", content, true)
      : null;
  const workspace =
    context.kind === "assignment"
      ? region("canvasdoc-workspace", content)
      : null;
  if (workspace) {
    workspace.host.hidden = true;
    workspace.container.style.cssText = "height:100%;min-height:0";
  }
  const mounts: Mounts = {
    sidebar: sidebar.container,
    conversation: conversation?.container ?? null,
    conversationHost: conversation?.host ?? null,
    navigation: navigation.container,
    main: main?.container ?? null,
    tabs: tabs?.container ?? null,
    workspace: workspace?.container ?? null,
    original,
  };
  // Hide the host as well as the portal container when switching tabs.
  const workspaceObserver = workspace
    ? new MutationObserver(() => {
        workspace.host.hidden = workspace.container.hidden;
      })
    : null;
  if (workspace)
    workspaceObserver!.observe(workspace.container, {
      attributes: true,
      attributeFilter: ["hidden"],
    });
  document.body.classList.add("canvasdoc-mounted");
  if (isHome) document.body.classList.add("canvasdoc-home");
  if (context.kind === "personal") document.body.classList.add("canvasdoc-personal");
  const control = document.createElement("div");
  document.body.append(control);
  const root = createRoot(control);
  root.render(<App initialContext={context} mounts={mounts} />);
  window.__canvasdoc = {
    dispose() {
      stopMaterials();
      workspaceObserver?.disconnect();
      root.unmount();
      control.remove();
      hosts.forEach((host) => host.remove());
      sheet.remove();
      document.body.classList.remove(
        "canvasdoc-mounted",
        "canvasdoc-home",
        "canvasdoc-personal",
        "canvasdoc-sidebar-open",
      );
      delete window.__canvasdoc;
    },
  };
}
mount().catch((error) =>
  { document.documentElement.classList.remove("canvasdoc-booting"); console.error(
    "Canvasdoc could not start:",
    error instanceof Error ? error.message : "Unknown error",
  ); },
);

function startDevRefresh() {
  if (typeof chrome !== "undefined" && chrome.runtime?.id) return;
  if (!["https://mac-mini.tail39179a.ts.net:3211", "http://localhost:3210"].includes(location.origin)) return;
  let version: string | undefined;
  let lastInput = 0;
  let canvasFormEdited = false;
  document.addEventListener("input", event => {
    lastInput = Date.now();
    if (!event.composedPath().some(node => node instanceof HTMLElement && node.id.startsWith("canvasdoc-"))) canvasFormEdited = true;
  }, true);
  setInterval(async () => {
    try {
      const response = await fetch("/canvasdoc/version.json", { cache: "no-store" });
      if (!response.ok) return;
      const next = (await response.json()).version;
      if (!version) { version = next; return; }
      if (next === version || canvasFormEdited || Date.now() - lastInput < 1800) return;
      if ([...document.querySelectorAll("[id^='canvasdoc-']")].some(host => host.shadowRoot?.querySelector('.aui-composer-attachments .aui-attachment-root, form [class~="group/attachment"]'))) return;
      if (await store.flush()) location.reload();
    } catch { /* Keep the current UI usable if the build server is unavailable. */ }
  }, 2000);
}
