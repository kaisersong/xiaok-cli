// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RoomWorkspaceLocalStore } from '../../electron/room-workspace-local.js';
import { createRoomWorkspaceRecovery } from '../../electron/room-workspace-recovery.js';
import { createRoomWorkspaceRuntime } from '../../electron/room-workspace-runtime.js';
const cleanup: Array<()=>void> = [];
afterEach(()=>{vi.restoreAllMocks();for(const fn of cleanup.splice(0).reverse())fn();});
function fixture(legacy=false) {
  const root=mkdtempSync(join(tmpdir(),'workspace-recovery-query-'));cleanup.push(()=>rmSync(root,{recursive:true,force:true}));
  const path=join(root,'local.sqlite');
  if(legacy){const db=new DatabaseSync(path);db.exec('CREATE TABLE room_workspace_local_journal(kind TEXT NOT NULL,key TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(kind,key))');db.prepare('INSERT INTO room_workspace_local_journal VALUES (?,?,?)').run('physical-claim','old',JSON.stringify({released:true,payload:'historical'}));db.close();}
  let store=new RoomWorkspaceLocalStore(path);cleanup.push(()=>store.close());
  return {path,get store(){return store;},reopen(){store.close();store=new RoomWorkspaceLocalStore(path);}};
}
describe('indexed recovery journal selection',()=>{
  it('does not deserialize completed historical payloads and preserves history through legacy upgrade/reopen',()=>{
    const f=fixture(true);for(let i=0;i<8;i++)f.store.saveRecord('physical-claim',`done-${i}`,{released:true,payload:'historical sentinel'.repeat(10000)});
    f.store.saveRecord('physical-claim','pending',{released:false,claim:{roomId:'r'}});
    const parse=vi.spyOn(JSON,'parse');
    expect(f.store.listRecoveryRecords('physical-claim')).toEqual([{released:false,claim:{roomId:'r'}}]);
    expect(parse).toHaveBeenCalledTimes(1);parse.mockRestore();
    f.reopen();expect(f.store.listRecoveryRecords('physical-claim')).toHaveLength(1);
    expect(f.store.getRecord('physical-claim','old')).toEqual({released:true,payload:'historical'});
  });
  it.each(['physical-claim','pending-confirmation'] as const)('keeps conservative states and updates immediately for %s',kind=>{
    const f=fixture();const field=kind==='physical-claim'?'released':'committed';
    for(const [key,value]of Object.entries({missing:{},nil:{[field]:null},no:{[field]:false},zero:{[field]:0},yes:{[field]:true}}))f.store.saveRecord(kind,key,{id:key,...value});
    expect(f.store.listRecoveryRecords<{id:string}>(kind).map(r=>r.id).sort()).toEqual(['missing','nil','no','zero']);
    f.store.saveRecord(kind,'no',{id:'no',[field]:true});expect(f.store.listRecoveryRecords(kind)).toHaveLength(3);
    f.store.saveRecord(kind,'yes',{id:'yes',[field]:false});expect(f.store.listRecoveryRecords(kind)).toHaveLength(4);
    f.reopen();expect(f.store.listRecoveryRecords(kind)).toHaveLength(4);
  });
  it('selects exact admission retry states and retains unknown external phases',()=>{
    const f=fixture();for(const state of ['requesting','no-executor','received','recovered'])f.store.saveRecord('admission-request',state,{state});
    expect(f.store.listRecoveryRecords<{state:string}>('admission-request').map(r=>r.state).sort()).toEqual(['no-executor','requesting']);
    for(const phase of ['completed','abandoned','claimed','prepared','released','future'])f.store.saveRecord('external-discussion-operation',phase,{phase});
    f.store.saveRecord('external-discussion-operation','missing',{});f.store.saveRecord('external-discussion-operation','nil',{phase:null});
    expect(f.store.listRecoveryRecords('external-discussion-operation')).toHaveLength(6);
  });
  it('upgrades a legacy journal containing JSON deeper than SQLite accepts without losing history',()=>{
    const f=fixture();const db=new DatabaseSync(f.path);
    db.exec("DROP INDEX IF EXISTS room_workspace_recovery_physical_claim");
    const raw='{"released":true,"payload":'+ '['.repeat(1001)+'0'+']'.repeat(1001)+'}';
    expect(()=>JSON.parse(raw)).not.toThrow();
    expect(db.prepare('SELECT json_valid(?) AS valid').get(raw)?.valid).toBe(0);
    db.prepare('INSERT INTO room_workspace_local_journal VALUES (?,?,?)').run('physical-claim','deep',raw);db.close();
    expect(()=>f.reopen()).not.toThrow();
    expect(f.store.listRecoveryRecords<{released:boolean}>('physical-claim')[0]?.released).toBe(true);
    expect(f.store.getRecord<{released:boolean}>('physical-claim','deep')?.released).toBe(true);
    expect(()=>f.store.listRecoveryRecords('untrusted-kind' as never)).toThrow('workspace_recovery_kind_invalid');
  });
  it('rejects non-string kinds without invoking user coercion',()=>{
    const f=fixture();const coerce=vi.fn(()=> 'physical-claim');
    expect(()=>f.store.listRecoveryRecords({[Symbol.toPrimitive]:coerce} as never)).toThrow('workspace_recovery_kind_invalid');
    expect(coerce).not.toHaveBeenCalled();
  });
  it('rolls back and closes its database if index migration fails',()=>{
    const root=mkdtempSync(join(tmpdir(),'workspace-index-failure-'));cleanup.push(()=>rmSync(root,{recursive:true,force:true}));
    const original=DatabaseSync.prototype.exec;
    vi.spyOn(DatabaseSync.prototype,'exec').mockImplementation(function(this:DatabaseSync,sql:string){if(sql.startsWith('CREATE INDEX'))throw new Error('index-failure');return original.call(this,sql);});
    const close=vi.spyOn(DatabaseSync.prototype,'close');
    expect(()=>new RoomWorkspaceLocalStore(join(root,'local.sqlite'))).toThrow('index-failure');
    expect(close).toHaveBeenCalledOnce();
  });
  it('does not rewrite or hide malformed legacy journal JSON',()=>{
    const f=fixture();const db=new DatabaseSync(f.path);
    db.prepare('INSERT INTO room_workspace_local_journal VALUES (?,?,?)').run('physical-claim','malformed','{bad');db.close();
    f.reopen();expect(()=>f.store.listRecoveryRecords('physical-claim')).toThrow(SyntaxError);
    const read=new DatabaseSync(f.path,{readOnly:true});try{expect(read.prepare('SELECT data FROM room_workspace_local_journal WHERE key=?').get('malformed')?.data).toBe('{bad');}finally{read.close();}
  });
  it('uses partial indexes for every recovery query',()=>{
    const f=fixture();const db=new DatabaseSync(f.path,{readOnly:true});cleanup.push(()=>db.close());
    const prepare=vi.spyOn((f.store as unknown as {db:DatabaseSync}).db,'prepare');
    for(const kind of ['physical-claim','pending-confirmation','admission-request','external-discussion-operation'] as const){
      f.store.listRecoveryRecords(kind);const sql=prepare.mock.calls.at(-1)![0];
      const plan=db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all();
      expect(plan.map(row=>String(row.detail)).join(' ')).toMatch(/USING INDEX room_workspace_recovery_/);
    }
  });
});

describe('production recovery callers',()=>{
  it('room recovery and periodic sweep never read full terminal journal history',async()=>{
    const f=fixture();f.store.saveRecord('physical-claim','done',{released:true,claim:{roomId:'r'}});
    f.store.saveRecord('admission-request','received',{state:'received',roomId:'r'});
    f.store.saveRecord('pending-confirmation','done',{committed:true,roomId:'r'});
    f.store.saveRecord('physical-claim','truthy',{released:'true',claim:{roomId:'r'}});
    f.store.saveRecord('pending-confirmation','truthy',{committed:'true',roomId:'r'});
    const full=vi.spyOn(f.store,'listRecords');const request=vi.fn();const additional=vi.fn(async()=>{});
    const recovery=createRoomWorkspaceRecovery({store:f.store,broker:{get:vi.fn(),request},isMutationOwner:()=>true,flushOutbox:async()=>{},recoverAdditional:additional});
    try {expect(await recovery.recoverRoom('r')).toEqual({released:0,committed:0,pending:0});recovery.start();await vi.waitFor(()=>expect(additional).toHaveBeenCalledOnce());}
    finally {await recovery.stop();}
    expect(full).not.toHaveBeenCalled();expect(request).not.toHaveBeenCalled();
  });
  it('external recovery skips terminal history and retains unknown pending operations without executing',async()=>{
    const f=fixture();f.store.saveRecord('external-discussion-operation','done',{phase:'completed'});
    f.store.saveRecord('external-discussion-operation','unknown',{operationId:'unknown',roomId:'r',sourceMessageId:'m',logicalAgentId:'a',phase:'claiming'});
    const full=vi.spyOn(f.store,'listRecords');const execute=vi.fn();const request=vi.fn();
    const runtime=createRoomWorkspaceRuntime({store:f.store,broker:{get:vi.fn(),request},wake:{claimWake:vi.fn(),completeWake:vi.fn()},execute,ensureProtocol:vi.fn()});
    expect(await runtime.recoverExternalDiscussions()).toEqual({completed:0,abandoned:0,pending:1});
    expect(f.store.getRecord<{recoveryState:string}>('external-discussion-operation','unknown')?.recoveryState).toBe('unknown_pending');
    expect(full).not.toHaveBeenCalled();expect(request).not.toHaveBeenCalled();expect(execute).not.toHaveBeenCalled();await runtime.shutdown();
  });
});
