/** Metadata custody only. These functions cannot create an issuer or Core lease. */
import {createRoomTurnCustody} from './original-room-turn-custody.js';
const freeze=Object.freeze,create=Object.create,assign=Object.assign;
const releaseMetadata=()=>{};
export function createOriginalMainDshChildFunctionCustody(methods:Readonly<{prepare?:Function;assert?:Function;terminal?:Function}>){
 const stock=createRoomTurnCustody(),metadata=freeze(assign(create(null),methods));let entered=false,pending:Promise<void>|undefined;
 function capture():Promise<void>{
  if(pending)return pending;
  pending=(async()=>{
   await stock.sdk(()=>metadata,undefined,[],{accept:value=>{if(value!==metadata)return false;entered=true;return true;},consumer:releaseMetadata,strictProxyGraph:true});
   await stock.consumeResource(releaseMetadata,metadata,[]);await stock.waitPhysicalKnown();
  })();return pending;
 }
 async function join():Promise<void>{
  if(pending)try{await pending;}catch{/* The original positive Promise keeps its cause. */}
  let first:{raw:unknown}|undefined;
  if(entered)try{await stock.consumeResource(releaseMetadata,metadata,[]);}catch(raw){first={raw};stock.inventory(raw);}
  try{await stock.waitPhysicalKnown();}catch(raw){first??={raw};}if(first)throw first.raw;
 }
 return freeze({capture,join});
}
