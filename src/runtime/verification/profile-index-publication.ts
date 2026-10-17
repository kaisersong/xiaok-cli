import {randomUUID} from 'node:crypto';
import {chmodSync,closeSync,constants,fchmodSync,fstatSync,fsyncSync,lstatSync,mkdirSync,openSync,readFileSync,renameSync,unlinkSync,writeFileSync,type Stats} from 'node:fs';
import {join} from 'node:path';
import type {Database} from 'better-sqlite3';
import {syncDirectoryTreeStrict} from '../../utils/atomic-file.js';
import {canonicalVerificationJson as json} from './protocol.js';
import type {PublicProfileIndex} from './profile-owner-registry.js';
function sync(value:unknown){if(value!==undefined){void Promise.resolve(value).catch(()=>{});throw Error('profile_index_sync');}}
function probe(path:string):Stats|undefined{try{return lstatSync(path);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return undefined;throw error;}}
export function parsePublicProfileIndex(raw:unknown):Readonly<PublicProfileIndex>{
 const text=json(raw);if(Buffer.byteLength(text)>4096)throw Error('profile_index_size');const v=JSON.parse(text);
 if(!v||Object.keys(v).sort().join(',')!=='accountId,authorityId,profileId,uid,version'||v.version!==1||!Number.isSafeInteger(v.uid)||v.uid<1||v.uid>=0xffffffff||![v.authorityId,v.profileId].every(x=>typeof x==='string'&&x.length>0&&Buffer.byteLength(x)<=160&&!/[\x00-\x1f\x7f]/.test(x))||typeof v.accountId!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v.accountId))throw Error('profile_index_schema');return Object.freeze(v);
}
/** Private durable filesystem port. Its installed wrapper must supply the fixed
 * protected namespace and real service identity; this factory alone is not that proof. */
export function createProfileIndexPublisher(input:{root:string;database:Database;authorityId:string;assertCurrent():void}){
 const {root,database:db,authorityId,assertCurrent}=input,initial=lstatSync(root),directory=join(root,'principals');
 if(initial.isSymbolicLink()||!initial.isDirectory()||(initial.mode&0o777)!==0o755||initial.blksize>4096)throw Error('profile_index_identity');let busy=false;
 function current(){sync(assertCurrent());const s=lstatSync(root);if(s.isSymbolicLink()||!s.isDirectory()||s.dev!==initial.dev||s.ino!==initial.ino||s.uid!==initial.uid||(s.mode&0o777)!==0o755)throw Error('profile_index_identity');}
 function checkDirectory(create:boolean){let s=probe(directory);if(!s&&create){mkdirSync(directory,{mode:0o755});chmodSync(directory,0o755);s=lstatSync(directory);}if(!s||s.isSymbolicLink()||!s.isDirectory()||s.uid!==initial.uid||(s.mode&0o777)!==0o755)throw Error('profile_index_identity');}
 function read(path:string):string|undefined{const s=probe(path);if(!s)return undefined;if(s.isSymbolicLink()||!s.isFile()||s.uid!==initial.uid||s.nlink!==1||(s.mode&0o777)!==0o644||s.size>4096)throw Error('profile_index_identity');const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{const actual=fstatSync(fd);if(actual.dev!==s.dev||actual.ino!==s.ino||actual.uid!==s.uid||actual.nlink!==1||actual.size>4096||(actual.mode&0o777)!==0o644)throw Error('profile_index_identity');const data=readFileSync(fd),after=fstatSync(fd);if(data.length!==actual.size||after.size!==actual.size||after.ctimeMs!==actual.ctimeMs||after.mtimeMs!==actual.mtimeMs)throw Error('profile_index_changed');return new TextDecoder('utf-8',{fatal:true}).decode(data);}finally{closeSync(fd);}}
 function intent(index:Readonly<PublicProfileIndex>){if(index.authorityId!==authorityId)throw Error('profile_index_binding');const exists=db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='verification_profiles'").get();if(!exists)throw Error('profile_index_intent');const row=db.prepare('SELECT * FROM verification_profiles WHERE uid=?').get(index.uid) as {account_id:string;profile_id:string;state:string}|undefined;if(!row||row.account_id!==index.accountId||row.profile_id!==index.profileId||!['pending','active'].includes(row.state))throw Error('profile_index_intent');}
 function exclusive(work:()=>void){if(busy)throw Error('profile_index_reentrant');busy=true;try{work();}finally{busy=false;}}
 return Object.freeze({
  publish(raw:Readonly<PublicProfileIndex>):void{exclusive(()=>{
   if(db.inTransaction)throw Error('profile_index_transaction');const index=parsePublicProfileIndex(raw);current();intent(index);checkDirectory(true);const path=join(directory,String(index.uid)+'.json'),contents=json(index),existing=read(path);
   if(existing!==undefined&&existing!==contents)throw Error('profile_index_conflict');
   if(existing===undefined){const temp=join(directory,'.profile-'+randomUUID()+'.tmp');let fd:number|undefined,renamed=false;
    let settledBodyFailure: {
        error: unknown;
    } | undefined;
    try {
        fd = openSync(temp, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
        writeFileSync(fd, contents);
        fchmodSync(fd, 0o644);
        fsyncSync(fd);
        closeSync(fd);
        fd = undefined;
        current();
        intent(index);
        renameSync(temp, path);
        renamed = true;
    }
    catch (error) {
        settledBodyFailure = { error };
    }
    {
        if (fd !== undefined)
            closeSync(fd);
        if (!renamed)
            try {
                unlinkSync(temp);
            }
            catch (error) {
                if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
                    throw error;
            }
    }
    if (settledBodyFailure)
        throw settledBodyFailure.error;
   }
   // Existing bytes after a prior failed rename barrier are not durable evidence.
   syncDirectoryTreeStrict(directory);syncDirectoryTreeStrict(root);current();intent(index);if(read(path)!==contents)throw Error('profile_index_changed');
  });},
  assertPublished(raw:Readonly<PublicProfileIndex>):void{exclusive(()=>{const index=parsePublicProfileIndex(raw);current();intent(index);checkDirectory(false);if(read(join(directory,String(index.uid)+'.json'))!==json(index))throw Error('profile_index_missing');current();});},
 });
}
