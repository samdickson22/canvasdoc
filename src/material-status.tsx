import { RefreshCw } from "lucide-react";
import { syncMaterials, useMaterialSync } from "./material-sync";
export function MaterialStatus() {
  const state=useMaterialSync();
  const busy=state.phase === "checking" || state.phase === "syncing";
  return <div className="material-status" role="status">
    <span>{state.detail}{busy && state.total ? ` (${state.completed}/${state.total})` : ""}</span>
    <button type="button" className="icon-button" disabled={busy} title="Check course materials" aria-label="Sync course materials" onClick={()=>void syncMaterials(undefined,false,true)}><RefreshCw size={13}/></button>
    {state.errors.length>0 && <details><summary>Details</summary><ul>{state.errors.map((error,i)=><li key={i}>{error}</li>)}</ul></details>}
  </div>;
}
