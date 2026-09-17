import { useEffect, useRef, useState } from "react";
import { catchUp } from "./catch-up";
import { useData } from "./store";

export function CatchUp() {
  const { catchUp: saved } = useData();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const digest = saved?.digest;
  return (
    <section className="catch-up" aria-label="Canvas catch-up">
      <button
        className="secondary-button"
        disabled={busy}
        aria-busy={busy}
        onClick={async () => {
          if (controller.current) return;
          const request = new AbortController();
          controller.current = request;
          setBusy(true);
          setError("");
          setExpanded(false);
          const timeout = setTimeout(
            () => request.abort(new Error("Canvas took too long. Try again.")),
            120_000,
          );
          try {
            await catchUp(request.signal);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            clearTimeout(timeout);
            controller.current = null;
            setBusy(false);
          }
        }}
      >
        {busy ? "Checking Canvas…" : "Catch me up"}
      </button>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {digest && (
        <div aria-live="polite">
          <p>
            {!digest.checked
              ? "No sources could be checked. Your comparison is unchanged."
              : digest.first
                ? "Current overview. Up to five open assignments, overdue first. This establishes your catch-up baseline."
                : "Changes since your previous catch-up."}{" "}
            <small>Checked {new Date(digest.at).toLocaleString()}.</small>
          </p>
          <p>
            {digest.checked} visible sources checked.
            {!!digest.checked && !digest.first && !digest.items.length
              ? " No changes found in the sources checked."
              : ""}
          </p>
          <ul>
            {digest.items.slice(0, expanded ? undefined : 5).map((item) => (
              <li key={item.id}>
                <a href={item.href}>{item.title}</a>
                <small>{item.detail}</small>
              </li>
            ))}
          </ul>
          {digest.items.length > 5 && (
            <button
              className="text-button"
              onClick={() => setExpanded(!expanded)}
            >
              {expanded
                ? "Show less"
                : `Show all ${digest.items.length} updates`}
            </button>
          )}
          {!!digest.coverage.length && (
            <details open>
              <summary>
                Incomplete coverage. Unavailable sources keep their previous
                baseline.
              </summary>
              <ul>
                {digest.coverage.map((message, i) => (
                  <li key={i}>{message}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </section>
  );
}
