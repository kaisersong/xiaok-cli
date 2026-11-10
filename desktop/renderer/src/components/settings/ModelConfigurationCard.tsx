import type {ReactNode} from 'react'
import {useLocale} from '../../contexts/LocaleContext'
import {ModelActionsMenu,type ModelMenuAction} from './ModelActionsMenu'
export const modelConfigurationCardClass=(selected:boolean)=>`rounded-lg border p-3 ${selected?'border-[var(--c-accent)] bg-[var(--c-accent)]/5':'border-[var(--c-border-subtle)] bg-[var(--c-bg-menu)]'}`
export function ModelConfigurationCard({name,description,status,selected=false,primary,actions,active=true,children,nameAccessory}:{name:string;description?:string;status:string;selected?:boolean;primary?:ReactNode;actions:ModelMenuAction[];active?:boolean;children?:ReactNode;nameAccessory?:ReactNode}){
 const {t}=useLocale();const ds=t.desktopSettings
 return <article aria-label={name} className={`${modelConfigurationCardClass(selected)} flex flex-col gap-2`}>
  <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex min-w-0 flex-col gap-1"><div className="flex flex-wrap items-center gap-2"><strong className="text-sm text-[var(--c-text-heading)]">{name}</strong>{nameAccessory}{selected&&<span className="rounded bg-[var(--c-accent)]/10 px-1.5 py-0.5 text-[10px] text-[var(--c-accent)]">{ds.modelConfigCurrent}</span>}</div>{description&&<p className="text-xs text-[var(--c-text-muted)]">{description}</p>}</div><div className="flex items-center gap-2"><span className="text-xs text-[var(--c-text-muted)]">{status}</span>{primary}<ModelActionsMenu label={name} items={actions} active={active}/></div></div>
  {children}
 </article>
}
