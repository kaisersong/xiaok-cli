import {lstatSync,opendirSync} from 'node:fs';
import {join} from 'node:path';

export const COMPOUND_DOMAIN_RESERVED_BYTES = 1024 * 1024;
const MAXIMUM_INDEX_BYTES = 256 * 1024;
/** Budget accounting only; existence is never authorization or recovery evidence.
 * Unknown files remain untouched and prevent claiming this bounded reservation. */
export function reserveCompoundDomainBytes(profileRoot:string, requested=false, additionalBytes=0):number {
 if(!Number.isSafeInteger(additionalBytes)||additionalBytes<0)throw Error('compound_domain_budget_exceeded');
 const directory=join(profileRoot,'compound-domains');
 let stat:ReturnType<typeof lstatSync>;
 try { stat=lstatSync(directory); }
 catch(error) { if((error as NodeJS.ErrnoException).code==='ENOENT')return requested?COMPOUND_DOMAIN_RESERVED_BYTES:0;throw error; }
 if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('compound_domain_namespace');
 const entries=opendirSync(directory);let bytes=0,count=0;
 try {
  for(let entry=entries.readSync();entry;entry=entries.readSync()){
   if(++count>4||!['initializing.json','index.json','owner-state.json','retired-generations.json'].includes(entry.name))throw Error('compound_domain_unknown_file');
   const file=lstatSync(join(directory,entry.name));
   if(!file.isFile()||file.isSymbolicLink()||file.size>(entry.name==='owner-state.json'?8192:entry.name==='retired-generations.json'?128*1024:MAXIMUM_INDEX_BYTES))throw Error('compound_domain_file_limit');
   bytes+=file.size;
  }
 }finally{entries.closeSync();}
 if(bytes+additionalBytes+2*MAXIMUM_INDEX_BYTES>COMPOUND_DOMAIN_RESERVED_BYTES)throw Error('compound_domain_budget_exceeded');
 return COMPOUND_DOMAIN_RESERVED_BYTES;
}
