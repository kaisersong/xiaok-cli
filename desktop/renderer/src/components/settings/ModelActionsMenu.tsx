import {useEffect,useId,useRef,useState} from 'react'
import {Ellipsis,Check} from 'lucide-react'
import {useLocale} from '../../contexts/LocaleContext'
import {secondaryButtonSmCls,secondaryButtonBorderStyle} from '../buttonStyles'

export type ModelMenuAction={key:string;label:string;onSelect:()=>void;disabled?:boolean;danger?:boolean;checked?:boolean;description?:string}
export function ModelActionsMenu({label,items,active=true,triggerText,disabled=false}:{label:string;items:ModelMenuAction[];active?:boolean;triggerText?:string;disabled?:boolean}){
 const {t}=useLocale();const ds=t.desktopSettings;const id=useId()
 const [open,setOpen]=useState(false);const [up,setUp]=useState(false)
 const root=useRef<HTMLDivElement>(null);const button=useRef<HTMLButtonElement>(null);const menu=useRef<HTMLDivElement>(null);const fromLast=useRef(false)
 const close=(restore=false)=>{setOpen(false);if(restore)button.current?.focus()}
 const enabled=()=>Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')??[])
 useEffect(()=>{if(!active||disabled)setOpen(false)},[active,disabled])
 useEffect(()=>{
  if(!open)return
  const nodes=enabled();nodes[fromLast.current?nodes.length-1:0]?.focus()
  const outside=(event:Event)=>{if(!root.current?.contains(event.target as Node))setOpen(false)}
  const resize=()=>setOpen(false)
  document.addEventListener('pointerdown',outside);document.addEventListener('click',outside);window.addEventListener('resize',resize)
  return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('click',outside);window.removeEventListener('resize',resize)}
 },[open])
 const show=(last=false)=>{if(!active||disabled)return;fromLast.current=last;const rect=button.current?.getBoundingClientRect();setUp(!!rect&&window.innerHeight-rect.bottom<Math.min(280,items.length*40+12)&&rect.top>150);setOpen(true)}
 return <div ref={root} className="relative shrink-0" onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node|null))setOpen(false)}}>
  <button ref={button} type="button" disabled={disabled} aria-label={triggerText?ds.modelConfigChangeFor(label):ds.modelConfigMore(label)} aria-haspopup="menu" aria-expanded={open} aria-controls={open?id:undefined}
   className={triggerText?secondaryButtonSmCls:'flex size-8 items-center justify-center rounded-lg border border-[var(--c-border-subtle)] text-[var(--c-text-muted)] hover:bg-[var(--c-bg-deep)] disabled:opacity-40'} style={triggerText?secondaryButtonBorderStyle:undefined}
   onClick={()=>open?close():show()} onKeyDown={event=>{if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();show(event.key==='ArrowUp')}else if(event.key==='Escape'){event.preventDefault();close(true)}}}>
   {triggerText??<Ellipsis size={17}/>}
  </button>
  {open&&active&&<div ref={menu} id={id} role="menu" aria-label={ds.modelConfigMore(label)} className={`absolute right-0 z-40 min-w-52 max-w-72 overflow-y-auto rounded-xl border border-[var(--c-border-subtle)] bg-[var(--c-bg-menu)] p-1 shadow-lg ${up?'bottom-full mb-1':'top-full mt-1'}`} style={{maxHeight:280}}
   onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close(true)}else if(event.key==='Tab'){close(true)}else if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();const nodes=enabled(),current=nodes.indexOf(document.activeElement as HTMLButtonElement);if(nodes.length)nodes[event.key==='Home'?0:event.key==='End'?nodes.length-1:(current+(event.key==='ArrowDown'?1:-1)+nodes.length)%nodes.length]?.focus()}}}>
   {items.map(item=><button key={item.key} type="button" role={item.checked===undefined?'menuitem':'menuitemradio'} aria-label={item.label} aria-describedby={item.description?`${id}-${item.key}-description`:undefined} aria-checked={item.checked} disabled={item.disabled} tabIndex={-1} title={item.description??(item.disabled?ds.modelConfigUnavailable:undefined)}
    className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-[var(--c-bg-deep)] focus:bg-[var(--c-bg-deep)] focus:outline-none disabled:cursor-not-allowed disabled:opacity-40 ${item.danger?'text-[var(--c-status-error-text)]':'text-[var(--c-text-primary)]'}`}
    onClick={()=>{if(item.disabled)return;close(true);item.onSelect()}}><span>{item.label}{item.description&&<span id={`${id}-${item.key}-description`} className="block mt-1 text-xs text-[var(--c-text-muted)]">{item.description}</span>}</span>{item.checked&&<Check size={14}/>}</button>)}
  </div>}
 </div>
}
