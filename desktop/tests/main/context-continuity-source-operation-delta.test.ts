// @vitest-environment node
import {expect,it} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ContinuityService} from '../../electron/context-continuity/service.js';
import {captureCanonicalStoreState,captureCanonicalStoreStateWithSourceIntent} from '../../electron/context-continuity/sync-canonical-state.js';
function fixture(){const root=mkdtempSync(join(tmpdir(),'continuity-source-delta-')),service=new ContinuityService({dbPath:join(root,'state.sqlite'),profileId:'profile'});return{db:service.store.db,close(){service.close();rmSync(root,{recursive:true,force:true});}};}
const operation=Object.freeze({kind:'canonicalSourceBootstrapV1',id:'a'.repeat(64),request_hash:'b'.repeat(64),result:JSON.stringify({schemaVersion:1,manifestHash:'c'.repeat(64)})});
it('models exactly one immutable source intent row without changing actual SQL, retaining all other operation rows',()=>{
 const f=fixture();try{const before=captureCanonicalStoreState(f.db),expected=captureCanonicalStoreStateWithSourceIntent(f.db,operation);expect(captureCanonicalStoreState(f.db)).toEqual(before);expect(f.db.prepare('SELECT COUNT(*) AS n FROM operations').get()?.n).toBe(0);expect(expected.publicationHash).not.toBe(before.publicationHash);expect(expected.policyHash).toBe(before.policyHash);
 f.db.prepare('INSERT INTO operations VALUES (?,?,?,?)').run(operation.kind,operation.id,operation.request_hash,operation.result);expect(captureCanonicalStoreState(f.db)).toEqual(expected);expect(()=>captureCanonicalStoreStateWithSourceIntent(f.db,operation)).toThrow('canonical_store_state_unavailable');
 f.db.prepare('INSERT INTO operations VALUES (?,?,?,?)').run('unrelated','unrelated','anything','{}');expect(captureCanonicalStoreState(f.db).publicationHash).not.toBe(expected.publicationHash);
 }finally{f.close();}
});
it('refuses proxies, accessors, extra row fields, foreign kinds and oversized intent without executing a caller getter',()=>{
 const f=fixture();try{let reads=0;const getter=Object.defineProperty({...operation},'result',{enumerable:true,get(){reads++;return operation.result;}});
 for(const row of [new Proxy(operation,{}),getter,{...operation,extra:1},{...operation,kind:'canonicalExportVersionV1'},{...operation,result:'x'.repeat(128*1024)}])expect(()=>captureCanonicalStoreStateWithSourceIntent(f.db,row)).toThrow('canonical_store_state_unavailable');expect(reads).toBe(0);
 }finally{f.close();}
});
