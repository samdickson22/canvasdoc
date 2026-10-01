import { useContext, useMemo, useState } from 'react';
import { Menu } from '@base-ui/react/menu';
import { RadioGroup } from '@base-ui/react/radio-group';
import { Radio } from '@base-ui/react/radio';
import { CheckIcon, ChevronDownIcon, ChevronRightIcon } from 'lucide-react';
import { ModelSelector } from './assistant-ui/components/assistant-ui/elements/model-selector.aui';
import { useModelSelectorEfforts, type ModelOption } from './assistant-ui/components/assistant-ui/elements/model-selector';
import { CommandGroup, CommandItem } from './assistant-ui/components/ui/command';
import { PortalContainerContext } from './assistant-ui/lib/portal-container';
import { cn } from './assistant-ui/lib/utils';
import { useConnection } from './runtime/client';
import { store, useData } from './store';
import { usageSummary } from './runtime/plan';

const EFFORT_NAMES: Record<string, string> = { low: 'Low', medium: 'Med', high: 'High', xhigh: 'Extra high' };
const MAIN_EFFORTS = ['low', 'medium', 'high'];
const pill = 'focus-visible:ring-ring/50 text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer rounded-md px-2 py-1 text-xs transition-colors outline-none focus-visible:ring-1 data-checked:bg-accent data-checked:text-accent-foreground data-checked:font-medium';

/** Codex lists newest first. Like T3 Code's legacy section, the picker leads with the newest
 * model of each family (sol, astra, luna, …) in the newest generation and folds the rest away. */
function splitModels(models: readonly ModelOption[]) {
  const parsed = models.map(m => /^gpt-(\d+)(?:\.\d+)?-([a-z]+)$/.exec(m.id));
  const generation = Math.max(0, ...parsed.map(p => (p ? Number(p[1]) : 0)));
  const families = new Set<string>();
  const current = models.filter((_, i) => {
    const p = parsed[i];
    if (!p || Number(p[1]) !== generation || families.has(p[2]!)) return false;
    families.add(p[2]!);
    return true;
  });
  return current.length ? { current, more: models.filter(m => !current.includes(m)) } : { current: models, more: [] };
}

function ModelList({ models, value }: { models: readonly ModelOption[]; value?: string }) {
  const { current, more } = useMemo(() => splitModels(models), [models]);
  const [expanded, setExpanded] = useState(() => more.some(m => m.id === value));
  return (
    <ModelSelector.List>
      <CommandGroup>
        {current.map(model => <ModelSelector.Item key={model.id} model={model} />)}
        {more.length > 0 && (
          <CommandItem value="canvasdoc-more-models" aria-expanded={expanded} onSelect={() => setExpanded(v => !v)} className="rounded-lg py-2 ps-3 pe-3">
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="font-medium">More models</span>
              <span className="text-muted-foreground text-xs">{more.length} models</span>
            </span>
            <ChevronRightIcon className={cn('size-4 transition-transform', expanded && 'rotate-90')} />
          </CommandItem>
        )}
        {expanded && more.map(model => <ModelSelector.Item key={model.id} model={model} />)}
      </CommandGroup>
    </ModelSelector.List>
  );
}

/** Low, Med and High stay on one row; any higher levels the model offers open from More. */
function EffortRow() {
  const { efforts, effort, setEffort } = useModelSelectorEfforts();
  const container = useContext(PortalContainerContext);
  if (!efforts?.length) return null;
  const main = efforts.filter(e => MAIN_EFFORTS.includes(e.id));
  const extra = efforts.filter(e => !MAIN_EFFORTS.includes(e.id));
  const extraSelected = extra.find(e => e.id === effort);
  return (
    <div data-slot="model-selector-effort" className="flex cursor-default flex-col items-stretch gap-2 border-t px-3 py-2">
      <span className="text-muted-foreground text-xs">Thinking</span>
      <div className="flex items-center gap-0.5">
        <RadioGroup value={extraSelected ? '' : effort ?? ''} onValueChange={v => setEffort(v as string)} aria-label="Reasoning effort" className="flex items-center gap-0.5">
          {main.map(option => <Radio.Root key={option.id} value={option.id} className={pill}>{option.name}</Radio.Root>)}
        </RadioGroup>
        {extra.length > 0 && (
          <Menu.Root modal={false}>
            <Menu.Trigger className={cn(pill, 'flex items-center gap-1')} data-checked={extraSelected ? '' : undefined}>
              {extraSelected?.name ?? 'More'}
              <ChevronDownIcon className="size-3 opacity-60" />
            </Menu.Trigger>
            <Menu.Portal container={container}>
              <Menu.Positioner side="bottom" align="start" sideOffset={4} className="isolate z-50">
                <Menu.Popup className="bg-popover text-popover-foreground ring-foreground/10 min-w-32 rounded-lg p-1 text-xs shadow-md ring-1 outline-hidden">
                  <Menu.RadioGroup value={effort ?? ''} onValueChange={v => setEffort(v as string)}>
                    {extra.map(option => (
                      <Menu.RadioItem key={option.id} value={option.id} closeOnClick className="data-highlighted:bg-accent flex cursor-pointer items-center justify-between gap-3 rounded-md px-2 py-1.5 outline-none">
                        {option.name}
                        <Menu.RadioItemIndicator><CheckIcon className="size-3.5" /></Menu.RadioItemIndicator>
                      </Menu.RadioItem>
                    ))}
                  </Menu.RadioGroup>
                </Menu.Popup>
              </Menu.Positioner>
            </Menu.Portal>
          </Menu.Root>
        )}
      </div>
    </div>
  );
}

export function CodexModelSelector() {
  const connection=useConnection();
  const data=useData();
  const catalog=connection.models;
  const models=useMemo(()=>catalog?.map(m=>({id:m.id,name:m.name,description:m.description,efforts:m.efforts.map(id=>({id,name:EFFORT_NAMES[id] ?? id.charAt(0).toUpperCase()+id.slice(1)}))}))??[],[catalog]);
  const value=data.model?.id ?? connection.currentModel ?? models[0]?.id;
  if(!models.length)return <span className="model-unavailable" title="Connect an updated Canvasdoc CLI to load available models">{connection.currentModel || 'Codex'}</span>;
  const effort=data.model?.effort ?? (value===connection.currentModel ? connection.currentEffort : undefined) ?? catalog?.find(m=>m.id===value)?.defaultEffort;
  const usage=usageSummary(connection.usage);
  return <>
    {usage && <span className="codex-usage" data-warning={usage.warning || undefined} title={usage.detail} aria-label={usage.detail}>{usage.text}</span>}
    <ModelSelector.Root models={models} value={value} effort={effort} onValueChange={id=>{const m=catalog?.find(m=>m.id===id);void store.setModel(id,m?.efforts.includes(effort||'')?effort:m?.defaultEffort)}} onEffortChange={effort=>{if(value)void store.setModel(value,effort)}}>
      <ModelSelector.Trigger size="sm" className="codex-model-trigger"/>
      <ModelSelector.Content align="end" searchable={false}>
        <ModelList models={models} value={value}/>
        <EffortRow/>
      </ModelSelector.Content>
    </ModelSelector.Root>
  </>;
}
