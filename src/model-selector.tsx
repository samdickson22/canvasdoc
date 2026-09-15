import { useMemo } from 'react';
import { ModelSelector } from './assistant-ui/components/assistant-ui/elements/model-selector.aui';
import { useConnection } from './runtime/client';
import { store, useData } from './store';
export function CodexModelSelector() {
  const connection=useConnection();
  const data=useData();
  const catalog=connection.models;
  const models=useMemo(()=>catalog?.map(m=>({id:m.id,name:m.name,description:m.description,efforts:m.efforts.map(id=>({id,name:id.charAt(0).toUpperCase()+id.slice(1)}))}))??[],[catalog]);
  const value=data.model?.id ?? connection.currentModel ?? models[0]?.id;
  if(!models.length)return <span className="model-unavailable" title="Connect an updated Canvasdoc CLI to load available models">{connection.currentModel || 'Codex'}</span>;
  const effort=data.model?.effort ?? (value===connection.currentModel ? connection.currentEffort : undefined) ?? catalog?.find(m=>m.id===value)?.defaultEffort;
  return <ModelSelector models={models} value={value} effort={effort} onValueChange={id=>{const m=catalog?.find(m=>m.id===id);void store.setModel(id,m?.efforts.includes(effort||'')?effort:m?.defaultEffort)}} onEffortChange={effort=>{if(value)void store.setModel(value,effort)}} searchable size="sm" align="end" className="codex-model-trigger"/>;
}
