import {createHash,randomUUID} from 'node:crypto';
import type {AssistantCandidateDto} from '../shared/assistant-ipc-contract.js';
/** Read cursors are main-local observations, not mutation/acceptance grants. */
export class AssistantCandidatePager {
 private readonly cursors=new Map<string,{digest:string;offset:number}>();
 page(candidates:AssistantCandidateDto[],cursor?:string){
  const digest=createHash('sha256').update(JSON.stringify(candidates)).digest('hex');
  const prior=cursor?this.cursors.get(cursor):undefined;
  if(cursor&&(!prior||prior.digest!==digest))throw Error('assistant_candidate_cursor_changed');
  let offset=prior?.offset??0;
  const page:AssistantCandidateDto[]=[];
  let bytes=0;
  while(offset<candidates.length&&page.length<50){
   const candidate=candidates[offset]!;
   const size=Buffer.byteLength(JSON.stringify(candidate),'utf8')+1;
   if(bytes+size>160*1024){if(!page.length)throw Error('assistant_candidate_item_too_large');break;}
   page.push(candidate);bytes+=size;offset++;
  }
  let nextCursor:string|null=null;
  if(offset<candidates.length){
   for(const [token,state] of this.cursors)if(state.digest===digest&&state.offset===offset){nextCursor=token;break;}
   if(!nextCursor){nextCursor=randomUUID();this.cursors.set(nextCursor,{digest,offset});}
   while(this.cursors.size>100)this.cursors.delete(this.cursors.keys().next().value!);
  }
  return {candidates:page,nextCursor};
 }
}
