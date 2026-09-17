import {
  createContext,
  useContext,
  useEffect,
  useState,
  useRef,
  type ComponentProps,
} from "react";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import {
  escapeCurrencyDollars,
  normalizeMathDelimiters,
} from "@assistant-ui/react-markdown";
import katexCss from "katex/dist/katex.min.css";
import { WorkspaceLink } from "./workspace-link";
import { isLocalFileLink } from "./workspace-files";
import { markdownWorkspacePath } from "./markdown-paths";
import { useConnection, workspaceRequest } from "./runtime/client";
import { prepareWorkspaceDownload } from "./workspace-download";

export const markdownPlugins = [remarkGfm, remarkMath];
export const markdownRehypePlugins = [rehypeKatex];
export const preprocessMarkdown = (text: string) =>
  escapeCurrencyDollars(normalizeMathDelimiters(text));
export const MarkdownDocument = createContext<{
  path?: string;
  open?: (path: string) => void;
}>({});
export function MarkdownStyles() {
  const marker = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const root = marker.current?.getRootNode();
    if (!root || !(root instanceof ShadowRoot || root instanceof Document))
      return;
    // Font faces must be registered in the document, while equation styles belong
    // inside the shadow root. Install each sheet once, not once per message.
    if (!document.getElementById("canvasdoc-math-fonts")) {
      const fonts = document.createElement("style");
      fonts.id = "canvasdoc-math-fonts";
      fonts.textContent = (katexCss.match(/@font-face\{[^}]+\}/g) ?? []).join(
        "",
      );
      document.head.append(fonts);
    }
    if (!root.querySelector("style[data-canvasdoc-math]")) {
      const sheet = document.createElement("style");
      sheet.dataset.canvasdocMath = "";
      sheet.textContent = katexCss.replace(/@font-face\{[^}]+\}/g, "");
      (root instanceof Document ? root.head : root).append(sheet);
    }
  }, []);
  return <span hidden ref={marker} />;
}

export function MarkdownLink({
  href,
  node: _node,
  ...props
}: ComponentProps<"a"> & { node?: unknown }) {
  const { root } = useConnection();
  const document = useContext(MarkdownDocument);
  const local = !!href && isLocalFileLink(href);
  const path = local ? markdownWorkspacePath(href!, root, document.path) : null;
  if (!local) return <WorkspaceLink href={href} {...props} />;
  // An invalid local reference must not fall through to a Canvas URL.
  if (!path)
    return (
      <span title="File unavailable: outside the accessible Canvasdoc folder.">
        {props.children}
      </span>
    );
  if (document.open)
    return (
      <a
        {...props}
        href={encodeURI(path).replace(/#/g, "%23")}
        onClick={(event) => {
          event.preventDefault();
          document.open!(path);
        }}
      />
    );
  return (
    <WorkspaceLink
      {...props}
      href={path.split("/").map(encodeURIComponent).join("/")}
    />
  );
}

export function MarkdownImage({
  src,
  alt,
  node: _node,
  ...props
}: ComponentProps<"img"> & { node?: unknown }) {
  const { root, status } = useConnection();
  const document = useContext(MarkdownDocument);
  const local = typeof src === "string" && isLocalFileLink(src);
  const path = local
    ? markdownWorkspacePath(src as string, root, document.path)
    : null;
  const [loaded, setLoaded] = useState<{ path: string; url: string } | null>(
    null,
  );
  const [error, setError] = useState("");
  useEffect(() => {
    setLoaded(null);
    setError("");
    if (!local || !path || status !== "connected") return;
    let cancelled = false;
    let url: string | undefined;
    void prepareWorkspaceDownload(path, (p) =>
      workspaceRequest("files-read", p),
    )
      .then((file) => {
        if (!/^image\/(png|jpeg|gif|webp)$/.test(file.blob.type))
          throw new Error("This file is not a supported image.");
        if (cancelled) return;
        url = URL.createObjectURL(file.blob);
        setLoaded({ path, url });
      })
      .catch((e) => {
        if (!cancelled) setError((e as Error).message);
      });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [path, local, status]);
  if (!local) return <img {...props} src={src} alt={alt} />;
  if (loaded?.path === path && status === "connected")
    return <img {...props} src={loaded.url} alt={alt} />;
  return (
    <span role="status">
      {alt || "Image"}:{" "}
      {error ||
        (!path
          ? "File unavailable."
          : status !== "connected"
            ? "Connect your computer to load this image."
            : "Loading image…")}
    </span>
  );
}
