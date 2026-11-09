import {useEffect,useId,useRef} from 'react'
import {Modal} from '../shared/Modal'
import {useLocale} from '../../contexts/LocaleContext'
import {primaryButtonSmCls,secondaryButtonSmCls,secondaryButtonBorderStyle} from '../buttonStyles'
export function ModelActionDialog({open,title,message,onClose,onConfirm,danger=false}:{open:boolean;title:string;message:string;onClose:()=>void;onConfirm:()=>void;danger?:boolean}){
 const {t}=useLocale();const ds=t.desktopSettings;const id=useId();const cancel=useRef<HTMLButtonElement>(null)
 useEffect(()=>{if(!open)return;const previous=document.activeElement as HTMLElement|null;cancel.current?.focus();return()=>{if(previous?.isConnected&&!previous.closest('[hidden]'))previous.focus()}},[open])
 return <Modal open={open} title={title} onClose={onClose} width="540px"><div role="dialog" aria-modal="true" aria-labelledby={id} onKeyDown={event=>{if(event.key==='Tab'){const buttons=Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button'));const current=buttons.indexOf(document.activeElement as HTMLButtonElement);if(buttons.length){event.preventDefault();buttons[(current+(event.shiftKey?-1:1)+buttons.length)%buttons.length]?.focus()}}}}><h4 id={id} className="sr-only">{title}</h4><p className="break-words text-xs leading-relaxed text-[var(--c-text-secondary)]">{message}</p><div className="mt-5 flex justify-end gap-2"><button ref={cancel} type="button" className={secondaryButtonSmCls} style={secondaryButtonBorderStyle} onClick={onClose}>{ds.modelConfigCancel}</button><button type="button" className={primaryButtonSmCls} style={danger?{background:'#dc2626',color:'#fff'}:undefined} onClick={onConfirm}>{ds.modelConfigConfirm}</button></div></div></Modal>
}
