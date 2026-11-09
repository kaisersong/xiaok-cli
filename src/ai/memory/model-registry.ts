import * as fs from 'node:fs';
import * as path from 'node:path';
import { createWriteStream } from 'node:fs';
import { get } from 'node:https';
import { getConfigDir, loadConfig } from '../../utils/config.js';
import {randomUUID} from 'node:crypto';
import {types} from 'node:util';
import {acquireSaveLock} from '../runtime/session-store/mutation-lock.js';
import {retainSourceErrorTails} from '../../runtime/verification/source-error-tails.js';

interface DownloadableFile {
  filename: string;
  url: string;
  mirror?: string;
}

export interface ModelEntry {
  id: string;
  name: string;
  dims: number;
  size: string;
  languages: string;
  downloadFiles: DownloadableFile[];
  requiredFiles: string[];
}

const HF = 'https://huggingface.co';
const MIRROR = 'https://hf-mirror.com';

export const MODEL_REGISTRY: ModelEntry[] = [
  {
    id: 'all-MiniLM-L6-v2',
    name: 'MiniLM',
    dims: 384,
    size: '~90MB',
    languages: '英文为主，中英混合可用',
    requiredFiles: ['model.onnx', 'tokenizer.json'],
    downloadFiles: [
      {
        filename: 'model.onnx',
        url: `${HF}/sentence-transformers/all-MiniLM-L6-v2/resolve/main/onnx/model.onnx`,
        mirror: `${MIRROR}/sentence-transformers/all-MiniLM-L6-v2/resolve/main/onnx/model.onnx`,
      },
      {
        filename: 'tokenizer.json',
        url: `${HF}/sentence-transformers/all-MiniLM-L6-v2/resolve/main/tokenizer.json`,
        mirror: `${MIRROR}/sentence-transformers/all-MiniLM-L6-v2/resolve/main/tokenizer.json`,
      },
    ],
  },
  {
    id: 'bge-small-zh-v1.5',
    name: 'BGE 中文',
    dims: 512,
    size: '~95MB',
    languages: '中文优化，英文也可用',
    requiredFiles: ['model.onnx', 'model.onnx_data', 'tokenizer.json'],
    downloadFiles: [
      {
        filename: 'model.onnx',
        url: `${HF}/onnx-community/bge-small-zh-v1.5-ONNX/resolve/main/onnx/model.onnx`,
        mirror: `${MIRROR}/onnx-community/bge-small-zh-v1.5-ONNX/resolve/main/onnx/model.onnx`,
      },
      {
        filename: 'model.onnx_data',
        url: `${HF}/onnx-community/bge-small-zh-v1.5-ONNX/resolve/main/onnx/model.onnx_data`,
        mirror: `${MIRROR}/onnx-community/bge-small-zh-v1.5-ONNX/resolve/main/onnx/model.onnx_data`,
      },
      {
        filename: 'tokenizer.json',
        url: `${HF}/onnx-community/bge-small-zh-v1.5-ONNX/resolve/main/tokenizer.json`,
        mirror: `${MIRROR}/onnx-community/bge-small-zh-v1.5-ONNX/resolve/main/tokenizer.json`,
      },
    ],
  },
];

// Mutation membership comes from this original literal, not later public catalog edits.
const fixedEntries = new Map(MODEL_REGISTRY.map(entry => [entry.id, {
  ...entry,downloadFiles: entry.downloadFiles.map(file => ({...file})),requiredFiles: [...entry.requiredFiles],
}]));
const unsafeErrors = new WeakSet<object>();
const heldOperations = new Map<string, Operation>();
const then = Promise.prototype.then, apply = Reflect.apply;
type Operation = {uncertain: boolean; stocks: unknown[]; seen: Set<object>; tails: Set<Promise<unknown>>; release?: () => void};
function retain(op: Operation,raw: unknown): void {
  op.stocks.push(raw);
  try { retainSourceErrorTails(raw,(value,kind) => {
    op.stocks.push(value);
    if (kind === 'unknown') { op.uncertain = true; return; }
    const original = value as Promise<unknown>;
    if (op.seen.has(original)) return;
    op.seen.add(original);
    const pending = apply(then,original,[(value:unknown) => retain(op,value),(error:unknown) => retain(op,error)]) as Promise<unknown>;
    op.tails.add(pending);
    apply(then,pending,[() => op.tails.delete(pending),() => {op.uncertain=true;}]);
  }); } catch (error) { op.stocks.push(error); op.uncertain=true; }
}
async function drain(op: Operation): Promise<void> {
  while (op.tails.size) await Promise.allSettled([...op.tails]);
}
function unsafe(kind: 'path' | 'files'): never {
  const error = new Error(`embedding_model_unsafe_${kind}`);unsafeErrors.add(error);throw error;
}
function missing(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object' || types.isProxy(raw)) return false;
  const code=Object.getOwnPropertyDescriptor(raw,'code');return !!code && Object.hasOwn(code,'value') && code.value==='ENOENT';
}
function stat(pathname: string): fs.Stats | undefined {
  try { return fs.lstatSync(pathname); } catch (raw) { if (missing(raw)) return undefined;throw raw; }
}
function samePath(left: string,right: string): boolean {
  const a=path.resolve(left),b=path.resolve(right);return process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b;
}
function directory(pathname: string): fs.Stats | undefined {
  const value=stat(pathname);if(!value)return undefined;
  if(!value.isDirectory()||value.isSymbolicLink()||!samePath(fs.realpathSync(pathname),pathname)
    ||(typeof process.getuid==='function'&&value.uid!==process.getuid()))unsafe('path');
  return value;
}
function root(create: boolean): string | undefined {
  const config=path.resolve(getConfigDir());
  if(!stat(config)){if(!create)return undefined;fs.mkdirSync(config,{recursive:true,mode:0o700});}
  directory(config);
  const value=path.join(config,'embedding');
  if(!stat(value)){if(!create)return undefined;fs.mkdirSync(value,{mode:0o700});}
  directory(value);return value;
}
function files(dir: string,entry: ModelEntry,deleting: boolean): string[] | undefined {
  if(!directory(dir))return undefined;
  const allowed=new Set(entry.downloadFiles.map(file=>file.filename)),names=fs.readdirSync(dir);
  for(const name of names){
    const value=stat(path.join(dir,name));
    if(!value||!value.isFile()||value.isSymbolicLink()||value.nlink!==1)unsafe('files');
    if(!allowed.has(name)&& (deleting || !/^\.download-[a-f0-9-]+\.tmp$/.test(name)))unsafe('files');
  }
  return names;
}
function fixed(id: string): ModelEntry {
  const entry=fixedEntries.get(id);if(!entry)throw new Error('invalid_embedding_model');return entry;
}
async function withFiles<T>(id: string,create: boolean,body:(base:string,entry:ModelEntry,op:Operation)=>Promise<T>):Promise<T|undefined>{
  const entry=fixed(id),base=root(create);if(!base)return undefined;
  const key=path.join(base,id);if(heldOperations.has(key))throw new Error('embedding_model_busy');
  const op:Operation={uncertain:false,stocks:[],seen:new Set(),tails:new Set()};heldOperations.set(key,op);
  let result:T|undefined,first:{raw:unknown}|undefined;
  try {op.release=acquireSaveLock(path.join(base,`.model-files-${entry.id}.lock`));directory(base);result=await body(base,entry,op);}
  catch(raw){first={raw};retain(op,raw);}
  await drain(op);
  if(!op.uncertain){try{op.release?.();}catch(raw){retain(op,raw);op.uncertain=true;if(first)first={raw:new AggregateError([first.raw,raw],'embedding_files_primary_cleanup',{cause:first.raw})};else first={raw};}}
  await drain(op);
  if(!op.uncertain)heldOperations.delete(key);
  if(first)throw first.raw;
  if(op.uncertain)throw new Error('embedding_model_source_unconfirmed');
  return result;
}
export function getModelDir(modelId?: string): string {
  return path.join(getConfigDir(),'embedding',modelId||'all-MiniLM-L6-v2');
}
export function isModelDownloaded(modelId?: string): boolean {
  const entry=fixedEntries.get(modelId||'all-MiniLM-L6-v2');if(!entry)return false;
  try {const base=root(false);if(!base)return false;if(heldOperations.has(path.join(base,entry.id))||stat(path.join(base,`.model-files-${entry.id}.lock`)))return false;const names=files(path.join(base,entry.id),entry,false);return !!names&&entry.requiredFiles.every(name=>names.includes(name));}
  catch(raw){if(raw&&typeof raw==='object'&&unsafeErrors.has(raw))return false;throw raw;}
}
/** Directory presence only, not file integrity, model quality or Native qualification. */
export function modelFilesPresent(id: string): boolean {
  const entry=fixedEntries.get(id);if(!entry)return false;
  try {const base=root(false);return !!base&&!!directory(path.join(base,entry.id));}
  catch(raw){if(raw&&typeof raw==='object'&&unsafeErrors.has(raw))return false;throw raw;}
}
export function findModel(modelId: string): ModelEntry | undefined {return MODEL_REGISTRY.find(model=>model.id===modelId);}
export function getManualDownloadHint(modelId: string): {urls:{file:string;url:string}[];targetDir:string} {
  const entry=findModel(modelId);return {urls:entry?.downloadFiles.map(file=>({file:file.filename,url:file.url}))??[],targetDir:getModelDir(modelId)};
}
export async function deleteEmbeddingModelFiles(id: string,source:{requestSource:'user'|'agent'|'scheduler'}):Promise<void>{
  if(source?.requestSource!=='user')throw new Error('memory_settings_user_only');
  await withFiles(id,false,async(base,entry)=>{
    const live=await import('./embedding.js');
    if(typeof live.getLiveEmbeddingModelIds!=='function')throw new Error('embedding_model_live_owner_unavailable');
    const dir=path.join(base,entry.id),names=files(dir,entry,true);if(!names)return;
    const config=await loadConfig();
    const explicit=config.memory?.embedding?.model,legacy=config.memory?.modelId;
    const active=explicit??(typeof legacy==='string'&&fixedEntries.has(legacy)?legacy:'all-MiniLM-L6-v2');
    if(typeof active!=='string')throw new Error('embedding_model_configuration_unconfirmed');
    if(active===entry.id)throw new Error('embedding_model_active');
    // Config await may outlive another file writer; recheck immediately before effects.
    directory(base);files(dir,entry,true);
    const before=directory(dir)!;
    const ids=live.getLiveEmbeddingModelIds();
    if(!Array.isArray(ids)||ids.some(value=>typeof value!=='string'))throw new Error('embedding_model_live_owner_unconfirmed');
    if(ids.includes(entry.id))throw new Error('embedding_model_active');
    if(source?.requestSource!=='user')throw new Error('memory_settings_user_only');
    const staged=path.join(base,`.delete-${entry.id}-${randomUUID()}`);
    fs.renameSync(dir,staged);
    const after=directory(staged);if(!after||after.dev!==before.dev||after.ino!==before.ino)unsafe('path');
    const current=files(staged,entry,true)!;
    // Fixed flat unlinks only. An unexpected racing descendant is never traversed.
    for(const name of current){const file=path.join(staged,name),value=stat(file);if(!value||!value.isFile()||value.isSymbolicLink()||value.nlink!==1)unsafe('files');fs.unlinkSync(file);}
    fs.rmdirSync(staged);
  });
}
/** One original HTTP attempt. Close ACK and all entered stream tails precede resolution. */
function downloadFile(url:string,dest:string,op:Operation):Promise<void>{
  return new Promise<void>((resolve,reject)=>{
    let first:{raw:unknown}|undefined,closing=false;
    const requests:import('node:http').ClientRequest[]=[],responses:import('node:http').IncomingMessage[]=[],closed:Promise<void>[]=[];
    const temp=path.join(path.dirname(dest),`.download-${randomUUID()}.tmp`);
    let original:fs.Stats|undefined;
    let file:fs.WriteStream;
    try{file=createWriteStream(temp,{flags:'wx'});}catch(raw){retain(op,raw);op.uncertain=true;reject(raw);return;}
    op.stocks.push(file);
    const track=(stream:import('node:events').EventEmitter)=>{op.stocks.push(stream);closed.push(new Promise<void>(yes=>stream.once('close',yes)));};
    const fail=(raw:unknown)=>{if(!first)first={raw};retain(op,raw);finish();};
    const finish=()=>{
      if(closing)return;closing=true;
      for(const response of responses)try{response.destroy();}catch(raw){retain(op,raw);op.uncertain=true;first??={raw};}
      for(const request of requests)try{request.destroy();}catch(raw){retain(op,raw);op.uncertain=true;first??={raw};}
      try{file.close(error=>{
        if(error!==undefined&&error!==null){retain(op,error);op.uncertain=true;first??={raw:error};}
        void (async()=>{
          await Promise.all(closed);await drain(op);
          if(!op.uncertain){try{
            const current=stat(temp);if(!current||!original||current.dev!==original.dev||current.ino!==original.ino||!current.isFile()||current.nlink!==1)unsafe('files');
            if(first)fs.unlinkSync(temp);
            else {directory(path.dirname(dest));fs.linkSync(temp,dest);fs.unlinkSync(temp);}
          }catch(raw){retain(op,raw);op.uncertain=true;if(first)first={raw:new AggregateError([first.raw,raw],'embedding_download_cleanup',{cause:first.raw})};else first={raw};}}
          if(first)reject(first.raw);else if(op.uncertain)reject(new Error('embedding_download_unconfirmed'));else resolve();
        })().catch(raw=>{retain(op,raw);op.uncertain=true;reject(raw);});
      });}catch(raw){retain(op,raw);op.uncertain=true;if(first)reject(new AggregateError([first.raw,raw],'embedding_download_close',{cause:first.raw}));else reject(raw);}
    };
    file.once('open',fd=>{try{original=fs.fstatSync(fd);}catch(raw){fail(raw);}});
    file.once('error',fail);file.once('finish',finish);
    const request=(href:string)=>{
      if(closing)return;
      try{const current=get(href,{agent:false},response=>{
        responses.push(response);track(response);response.once('error',fail);response.once('aborted',()=>fail(new Error('embedding_download_aborted')));
        if(response.statusCode&&response.statusCode>=300&&response.statusCode<400&&response.headers.location){const next=new URL(response.headers.location,href).href;response.resume();request(next);return;}
        if(response.statusCode!==200){fail(new Error(`HTTP ${response.statusCode}`));return;}
        response.pipe(file);
      });requests.push(current);track(current);current.once('error',fail);}
      catch(raw){op.uncertain=true;fail(raw);}
    };
    request(url);
  });
}
export async function downloadModel(id:string):Promise<void>{
  await withFiles(id,true,async(base,entry,op)=>{
    const dir=path.join(base,entry.id);if(!stat(dir))fs.mkdirSync(dir,{mode:0o700});files(dir,entry,false);
    for(const file of entry.downloadFiles){
      const dest=path.join(dir,file.filename);if(stat(dest))continue;
      try{await downloadFile(file.url,dest,op);}
      catch(primary){
        if(op.uncertain||!file.mirror)throw primary;
        try{await downloadFile(file.mirror,dest,op);}
        catch(secondary){throw new AggregateError([primary,secondary],`embedding_download_failed:${file.filename}`,{cause:primary});}
      }
    }
  });
}
