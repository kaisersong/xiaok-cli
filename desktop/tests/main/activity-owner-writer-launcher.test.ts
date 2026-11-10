import {afterEach,expect,it} from 'vitest';
import {mkdtempSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ensureDesktopConversationActivityOwner,hasDesktopWriterRelay} from '../../electron/activity-owner-writer-launcher.js';
const roots:string[]=[];afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
it('a fake Main source cannot use a copied capsule to create files, inspect its methods, or launch an owner',async()=>{
 const root=mkdtempSync(join(tmpdir(),'writer-launch-deny-'));roots.push(root);let getters=0;const source=Object.create(null);for(const key of ['admission','openPrepare','seal'])Object.defineProperty(source,key,{get(){getters++;throw Error('fake source getter');},enumerable:true});
 const config={schemaVersion:1 as const,dataRoot:root,profileId:'p',actorId:'u',identity:{kind:'desktop' as const,path:join(root,'identity.sqlite')}};
 await expect(ensureDesktopConversationActivityOwner(config,{source,capsule:Object.freeze(Object.create(null)),service:{} as never})).rejects.toThrow();expect(getters).toBe(0);expect(readdirSync(root)).toEqual([]);
});
it('unregistered and Proxy service identities do not expose a relay or touch caller getters',()=>{
 let traps=0;const service=new Proxy({},{get(){traps++;throw Error('fake service getter');},getPrototypeOf(){traps++;throw Error('fake service prototype');}});expect(hasDesktopWriterRelay(service as never)).toBe(false);expect(hasDesktopWriterRelay({} as never)).toBe(false);expect(traps).toBe(0);
});
it('launcher options reject accessors before a caller can fabricate Native bootstrap provenance',async()=>{
 let gets=0;const options=Object.create(null);Object.defineProperty(options,'source',{get(){gets++;throw Error('source option getter');},enumerable:true});Object.assign(options,{service:{},capsule:{}});await expect(ensureDesktopConversationActivityOwner({} as never,options)).rejects.toThrow();expect(gets).toBe(0);
});
