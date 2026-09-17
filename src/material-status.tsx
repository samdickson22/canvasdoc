import { RefreshCw } from "lucide-react";
import { syncMaterials, useMaterialSync } from "./material-sync";
export function MaterialStatus() {
  const state=useMaterialSync();
  const entries = [...new Set([...(state.notices ?? []), ...state.errors])];
  const busy=state.phase === "checking" || state.phase === "syncing";
  return <div className="material-status" role="status">
    <span>{state.detail}{busy && state.total ? ` (${state.completed}/${state.total})` : ""}</span>
    <button type="button" className="icon-button" disabled={busy} title="Check course materials" aria-label="Sync course materials" onClick={()=>void syncMaterials(undefined,false,true)}><RefreshCw size={13}/></button>
    {entries.length > 0 && <details><summary>Sync log ({entries.length})</summary><ul>{entries.map(entry=><li key={entry}>{entry}</li>)}</ul></details>}
  </div>;
}
