import {useCallback,useEffect,useRef,useState} from 'react'
import {useLocale} from '../../contexts/LocaleContext'
import {ModelConfigurationCard} from './ModelConfigurationCard'
import {ModelActionDialog} from './ModelActionDialog'
import {ModelInfoButton} from './ModelInfoButton'
import {secondaryButtonSmCls,secondaryButtonBorderStyle} from '../buttonStyles'
interface ModelEntry{id:string;name:string;dims:number;size:string;languages:string;downloaded:boolean;filesPresent?:boolean;active:boolean;manualHint:{urls:{file:string;url:string}[];targetDir:string}}
export function MemoryModelSettings({active=true}:{active?:boolean}={}){
 const {t}=useLocale();const ds=t.desktopSettings
 const [models,setModels]=useState<ModelEntry[]>([]);const [loading,setLoading]=useState(true);const [busy,setBusy]=useState<string|null>(null);const [deleting,setDeleting]=useState(false);const [failed,setFailed]=useState<string|null>(null);const [error,setError]=useState(false);const [deleteError,setDeleteError]=useState(false);const [pending,setPending]=useState<ModelEntry|null>(null);const [pendingDelete,setPendingDelete]=useState<ModelEntry|null>(null);const running=useRef(false)
 const load=useCallback(async()=>{setModels(await window.xiaokDesktop.getEmbeddingModels())},[])
 useEffect(()=>{void load().catch(()=>setError(true)).finally(()=>setLoading(false))},[load])
 useEffect(()=>{if(!active){setPending(null);setPendingDelete(null)}},[active])
 const confirm=()=>{if(!pending||running.current)return;const model=pending;running.current=true;setPending(null);setBusy(model.id);setFailed(null);setError(false);setDeleteError(false);void(async()=>{try{if(!model.downloaded)await window.xiaokDesktop.downloadEmbeddingModel(model.id);await window.xiaokDesktop.setEmbeddingModel(model.id);await load()}catch{setFailed(model.id);setError(true)}finally{running.current=false;setBusy(null)}})()}
 const confirmDelete=()=>{if(!pendingDelete||pendingDelete.active||running.current)return;const model=pendingDelete;running.current=true;setPendingDelete(null);setBusy(model.id);setDeleting(true);setError(false);setDeleteError(false);void(async()=>{try{await window.xiaokDesktop.deleteEmbeddingModel(model.id);await load()}catch{setDeleteError(true);try{await load()}catch{setError(true)}}finally{running.current=false;setBusy(null);setDeleting(false)}})()}
 return <section className="rounded-xl border border-[var(--c-border-subtle)] bg-[var(--c-bg-menu)] p-4 flex flex-col gap-3">
  <div className="flex items-center gap-1.5"><h4 className="text-sm font-semibold">{ds.embeddingModelTitle}</h4><ModelInfoButton title={ds.embeddingModelHelpTitle} active={active}><p>{ds.embeddingModelDesc}</p><p>{ds.embeddingModelDownloadGuide}</p></ModelInfoButton></div>
  {loading&&<p className="text-xs text-[var(--c-text-muted)]">{t.loading}</p>}
  {error&&<p role="alert" className="text-xs text-amber-600">{ds.modelConfigError}</p>}
  {deleteError&&<p role="alert" className="text-xs text-amber-600">{ds.embeddingModelDeleteFailed}</p>}
  {models.map(m=><ModelConfigurationCard key={m.id} name={m.name} selected={m.active} description={`${m.size} · ${ds.embeddingModelDims(m.dims)} · ${m.languages}`} status={busy===m.id?deleting?ds.embeddingModelDeleting:ds.embeddingModelDownloading:m.downloaded?ds.modelConfigInstalled:ds.modelConfigNotInstalled} active={active}
   nameAccessory={<ModelInfoButton title={ds.embeddingModelManualGuideFor(m.name)} active={active}><p>{ds.embeddingModelManualStep1}</p>{m.manualHint.urls.map(u=><p className="break-all" key={u.file}>{u.file} · {u.url}</p>)}<p>{ds.embeddingModelManualStep2}</p><p className="break-all font-mono">{m.manualHint.targetDir}</p><p>{ds.embeddingModelManualStep3}</p></ModelInfoButton>}
   primary={<button type="button" className={secondaryButtonSmCls} style={secondaryButtonBorderStyle} disabled={!!busy||(m.active&&m.downloaded)} onClick={()=>setPending(m)}>{failed===m.id?ds.modelConfigRetry:m.downloaded?ds.modelConfigUse:ds.modelConfigDownloadAndUse}</button>}
   actions={[{key:'use',label:m.downloaded?ds.modelConfigUse:ds.modelConfigDownloadAndUse,disabled:!!busy||(m.active&&m.downloaded),onSelect:()=>setPending(m)},{key:'delete',label:ds.embeddingModelDelete,danger:true,disabled:!!busy||m.active||!(m.downloaded||m.filesPresent),description:m.active?ds.embeddingModelDeleteActive:undefined,onSelect:()=>setPendingDelete(m)}]}>
   {busy===m.id&&!m.downloaded&&!deleting&&<progress aria-label={ds.embeddingModelDownloading} className="w-full"/>}
  </ModelConfigurationCard>)}
  <ModelActionDialog open={active&&!!pending} title={pending?.downloaded?ds.embeddingModelSwitchTitle:ds.embeddingModelDownloadAndSwitchTitle} message={!pending?'':pending.downloaded?ds.embeddingModelSwitchConfirm(pending.name):ds.embeddingModelDownloadAndSwitchConfirm(pending.name,pending.size)} onClose={()=>setPending(null)} onConfirm={confirm}/>
  <ModelActionDialog open={active&&!!pendingDelete} title={ds.embeddingModelDelete} message={pendingDelete?ds.embeddingModelDeleteConfirm(pendingDelete.name):''} danger onClose={()=>setPendingDelete(null)} onConfirm={confirmDelete}/>
 </section>
}
