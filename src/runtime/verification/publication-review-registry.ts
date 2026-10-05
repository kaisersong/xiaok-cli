import {parsePublicationOperationReview} from './publication-operation-review.js';
import {randomBytes} from 'node:crypto';
import {canonicalVerificationJson as json,parseVerificationTuple,hashVerificationTuple,type VerificationTuple} from './protocol.js';
type Peer={uid:number;gid:number;pid:number;auditSessionId:number};
/** Private broker memory only. Registration never grants approval; consumption is
 * irreversible before any asynchronous process observation or native UI. */
export function createPublicationReviewRegistry(input:{now():number;observe(peer:Readonly<Peer>):Promise<string>}){
 const now=input.now.bind(input),observe=input.observe.bind(input),rows=new Map<string,{tuple:Readonly<VerificationTuple>;peer:string;start?:string;expires:number;bytes:number}>();const consumed=new WeakMap<object,{peer:string;start:string;expires:number}>();let closed=false;
 function time(){if(closed)throw Error('publication_registry_closed');const n=now();if(!Number.isSafeInteger(n)||n<0)throw Error('publication_registry_clock');return n;}
 function principal(p:Peer){if(!p||Object.keys(p).sort().join(',')!=='auditSessionId,gid,pid,uid'||Object.values(p).some(n=>!Number.isSafeInteger(n)||n<0)||p.uid<1||p.pid<1||p.auditSessionId<1)throw Error('publication_registry_peer');return json(p);}
 function prune(n:number){for(const [id,r]of rows)if(r.expires<=n)rows.delete(id);}
 return Object.freeze({
  async register(raw:unknown,p:Peer){const n=time();prune(n);const tuple=parseVerificationTuple(raw),peer=principal(p),bytes=Buffer.byteLength(json(tuple)),expires=Math.min(tuple.validUntil,n+300000);if(n<tuple.notBefore||expires<=n)throw Error('publication_registry_expired');if(rows.size>=4||[...rows.values()].reduce((s,r)=>s+r.bytes,bytes)>4*1024**2)throw Error('publication_registry_capacity');
   const ticket=randomBytes(32).toString('hex'),row={tuple,peer,expires,bytes,start:undefined as string|undefined};rows.set(ticket,row);
   try{const start=await observe(Object.freeze(JSON.parse(peer)));if(!/^\d+:\d+$/.test(start)||time()>=expires||rows.get(ticket)!==row)throw Error('publication_registry_identity');row.start=start;return Object.freeze({ticket,fullTupleHash:hashVerificationTuple(tuple)});}catch(error){rows.delete(ticket);throw error;}
  },
  async consume(ticket:string,hash:string,p:Peer){const row=rows.get(ticket);rows.delete(ticket);const n=time();if(!row||!row.start||row.expires<=n||row.peer!==principal(p)||hashVerificationTuple(row.tuple)!==hash)throw Error('publication_registry_binding');const start=await observe(Object.freeze(JSON.parse(row.peer)));if(start!==row.start||time()>=row.expires)throw Error('publication_registry_identity');consumed.set(row.tuple,{peer:row.peer,start:row.start,expires:row.expires});return row.tuple;},
  async assertCaller(tuple:Readonly<VerificationTuple>,p:Peer){const row=consumed.get(tuple);if(!row||row.peer!==principal(p)||time()>=row.expires)throw Error('publication_registry_binding');if(await observe(Object.freeze(JSON.parse(row.peer)))!==row.start||time()>=row.expires)throw Error('publication_registry_identity');},
  close(){closed=true;rows.clear();},
 });
}

/** Exact small metadata envelope; tuple bytes come only from the one-use registry. */
export async function consumePublicationReview(registry:ReturnType<typeof createPublicationReviewRegistry>,raw:unknown,peer:Peer){
 const serialized=json(raw);if(Buffer.byteLength(serialized)>65536)throw Error('broker_publication_metadata');const p=JSON.parse(serialized);
 if(!p||Object.keys(p).sort().join(',')!=='fullTupleHash,metadata,ticket')throw Error('broker_publication_metadata');
 const tuple=await registry.consume(p.ticket,p.fullTupleHash,peer);
 if(!p.metadata||Object.keys(p.metadata).sort().join(',')!=='authorityId,challengeId,deadline,principal,purpose,requestSource,version')throw Error('broker_publication_metadata');
 const review=parsePublicationOperationReview({...p.metadata,tuple});
 return Object.freeze({review,assertCaller:()=>registry.assertCaller(tuple,peer)});
}
