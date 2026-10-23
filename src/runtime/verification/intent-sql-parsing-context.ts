import type Database from 'better-sqlite3';
import {parseIntentContractEnrollment,type IntentContractEnrollment} from './intent-contract-enrollment.js';
import {parseIntentHostSubject} from './intent-host-subject.js';
import {canonicalVerificationJson as json} from './protocol.js';

// Pure parser state only. No SQL rows, owner authority or verdicts are retained.
interface CachedContract {readonly prefix:string;readonly contract:IntentContractEnrollment['contract']}
interface Frame {cache:CachedContract|undefined}
const frames=new WeakMap<Database.Database,Frame>();
const apply=Reflect.apply,get=WeakMap.prototype.get,set=WeakMap.prototype.set,remove=WeakMap.prototype.delete;
const freeze=Object.freeze,parse=JSON.parse,startsWith=String.prototype.startsWith,slice=String.prototype.slice;
function frameFor(db:Database.Database):Frame|undefined{return apply(get,frames,[db]);}

/** Internal call sites must be synchronous; nested calls get independent caches. */
export function withIntentSqlParsingContext<T>(db:Database.Database,fn:()=>T):T {
 const outer=frameFor(db),frame:Frame={cache:undefined};apply(set,frames,[db,frame]);
 try{return fn();}finally{frame.cache=undefined;if(outer)apply(set,frames,[db,outer]);else apply(remove,frames,[db]);}
}

/** Decode the freshly read SQL text; cache only an original-parser accepted body. */
export function readIntentSqlContract(db:Database.Database,raw:string):Readonly<IntentContractEnrollment>{
 const frame=frameFor(db),cached=frame?.cache;
 if(cached&&apply(startsWith,raw,[cached.prefix])){
  try{
   const suffix=apply(slice,raw,[cached.prefix.length,-1]),subject=parseIntentHostSubject(parse(suffix));
   if(raw===cached.prefix+json(subject)+'}'&&subject.sessionId===cached.contract.sessionId&&subject.intentId===cached.contract.intentId&&(subject.stageId===null||cached.contract.stages.some(stage=>stage.stageId===subject.stageId)))return freeze({subject,contract:cached.contract});
  }catch{/* The original strict decoder supplies the original failure semantics. */}
 }
 const binding=parseIntentContractEnrollment(parse(raw));
 if(frame&&json(binding)===raw){const body=json(binding.contract);if(Buffer.byteLength(body)<=65536)frame.cache=freeze({prefix:'{"contract":'+body+',"subject":',contract:binding.contract});}
 return binding;
}
