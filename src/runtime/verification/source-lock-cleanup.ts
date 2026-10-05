import {lstatSync,openSync,closeSync,fsyncSync,readdirSync,constants} from 'node:fs';
import {join,parse,isAbsolute,normalize} from 'node:path';
import {acquireSaveLock} from '../../ai/runtime/session-store/mutation-lock.js';
const names={ 'profile-registry':'.profile-source-registry.lock','session-root':'.session-store-lock','task-root':'.task-store.save.lock','goal-file-root':'.goal-store.save.lock' } as const;
function decimal(value:string,positive=false){if(!/^(0|[1-9][0-9]{0,19})$/.test(value)||BigInt(value)>18446744073709551615n||positive&&value==='0')throw Error('source_cleanup_identity');return BigInt(value);}
/** Ordinary-UID recovery producer, using the original stale-lock algorithm.
 * Marker reconciliation is not custody, snapshot consistency or effect drain.
 * The installed parent derives these arguments from its approved private set. */
export function cleanupOriginalSourceLocks(args:readonly string[]):Readonly<{state:'markers-reconciled';count:number}>{
 if(process.platform!=='darwin'&&process.platform!=='linux')throw Error('source_cleanup_platform');
 if(args.length<5||(args.length-1)%4||(args.length-1)/4>64)throw Error('source_cleanup_arguments');
 const uid=decimal(args[0]!,true);if(process.getuid?.()===0||BigInt(process.getuid!())!==uid||process.geteuid!()!==process.getuid!())throw Error('source_cleanup_uid');
 const scopes:Array<{path:string;name:string;device:bigint;inode:bigint}>=[];const known=new Set<string>();
 for(let i=1;i<args.length;i+=4){const kind=args[i]!;if(!Object.hasOwn(names,kind))throw Error('source_cleanup_kind');const path=args[i+1]!,device=decimal(args[i+2]!),inode=decimal(args[i+3]!,true),name=names[kind as keyof typeof names];if(!isAbsolute(path)||normalize(path)!==path||path.includes('\0')||Buffer.byteLength(path)>4096)throw Error('source_cleanup_path');const key=device+':'+inode+':'+name;if(known.has(key))throw Error('source_cleanup_duplicate');known.add(key);scopes.push({path,name,device,inode});}
 function current(scope:typeof scopes[number]){const root=parse(scope.path).root;let path=root;for(const part of scope.path.slice(root.length).split('/').filter(Boolean)){path=join(path,part);const s=lstatSync(path);if(!s.isDirectory()||s.isSymbolicLink())throw Error('source_cleanup_path');}const s=lstatSync(scope.path,{bigint:true});if(!s.isDirectory()||s.isSymbolicLink()||s.dev!==scope.device||s.ino!==scope.inode)throw Error('source_cleanup_identity');}
 for(const scope of scopes)current(scope);
 for(const scope of scopes){current(scope);const marker=join(scope.path,scope.name),release=acquireSaveLock(marker);try{current(scope);if(scope.name==='.goal-store.save.lock'){const end=acquireSaveLock(join(scope.path,'.goal-native.save.lock'));try{current(scope);}finally{end();}}if(scope.name==='.session-store-lock'){
  const sessions=new Set<string>();for(const parent of [scope.path,join(scope.path,'.migrations'),join(scope.path,'.deletions')]){
   try{const st=lstatSync(parent);if(!st.isDirectory()||st.isSymbolicLink()||st.uid!==Number(uid))throw Error('source_cleanup_path');for(const name of readdirSync(parent)){if(/^[A-Za-z0-9_-]{1,160}\.json$/.test(name))sessions.add(name);else if(name.endsWith('.json')&&!name.startsWith('.'))throw Error('source_cleanup_session_name');}}
   catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  }
  for(const name of [...sessions].sort()){current(scope);const end=acquireSaveLock(join(scope.path,name+'.save-lock'));try{current(scope);}finally{end();}}
 }}finally{release();}current(scope);const fd=openSync(scope.path,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);try{fsyncSync(fd);}finally{closeSync(fd);}current(scope);try{lstatSync(marker);throw Error('source_cleanup_marker_unknown');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}}
 return Object.freeze({state:'markers-reconciled',count:scopes.length});
}
