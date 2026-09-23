import { RefreshCw } from "lucide-react";
import { syncMaterials, useMaterialSync } from "./material-sync.ts";
export function MaterialStatus(): React.JSX.Element {
  const state = useMaterialSync();
  const busy = state.phase === "checking" || state.phase === "syncing";
  return (
    <div className="material-status" role="status">
      <span>
        {state.detail}
        {busy && state.total ? ` (${state.completed}/${state.total})` : ""}
      </span>
      <button
        type="button"
        className="icon-button"
        disabled={busy}
        title="Check course materials"
        aria-label="Sync course materials"
        onClick={() => void syncMaterials(undefined, false, true)}
      >
        <RefreshCw size={13} />
      </button>
      {!!state.notices?.length && (
        <details>
          <summary>Availability</summary>
          <ul>
            {state.notices.map((notice, i) => (
              <li key={i}>{notice}</li>
            ))}
          </ul>
        </details>
      )}
      {state.errors.length > 0 && (
        <details>
          <summary>Details</summary>
          <ul>
            {state.errors.map((error, i) => (
              <li key={i}>{error}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
