// @vitest-environment node
import {afterEach,describe,expect,it,vi} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {DesktopMultiAgentStore} from '../../electron/desktop-multi-agent-store.js';
const cleanups:Array<()=>void>=[];
afterEach(()=>{vi.restoreAllMocks();for(const cleanup of cleanups.splice(0).reverse())cleanup();});
function setup(){const root=mkdtempSync(join(tmpdir(),'xiaok-main-transaction-fate-'));cleanups.push(()=>rmSync(root,{recursive:true,force:true}));const file=join(root,'groups.sqlite'),store=new DesktopMultiAgentStore(file);cleanups.push(()=>store.close());const reader=new DatabaseSync(file);cleanups.push(()=>reader.close());return {store,reader,root};}
function row(store:DesktopMultiAgentStore,id:string){store.registerThread({threadId:id,profileId:'profile',workspaceId:'workspace',cwd:'fixture'});}
function thrown(action:()=>unknown):{present:boolean;value:unknown}{try{action();return{present:false,value:undefined};}catch(value){return{present:true,value};}}
describe('original Main store transaction fate before A storage integration',()=>{
  it.each([Error('commit-return-failed'),undefined])('preserves exact post-COMMIT thrown value and rejects new mutations, while SQL truth stays readable',failure=>{
    const {store,reader}=setup(),exec=DatabaseSync.prototype.exec;let commits=0;
    const hook=vi.spyOn(DatabaseSync.prototype,'exec').mockImplementation(function(this:DatabaseSync,sql:string){const result=exec.call(this,sql);if(sql==='COMMIT'){commits++;throw failure;}return result;});
    const outcome=thrown(()=>store.transaction(port=>{row(port as DesktopMultiAgentStore,'committed');return 'result';}));hook.mockRestore();
    expect(outcome.present).toBe(true);expect(outcome.value).toBe(failure);expect(commits).toBe(1);
    expect(reader.prepare('SELECT thread_id FROM thread_bindings WHERE thread_id=?').get('committed')).toMatchObject({thread_id:'committed'});
    expect(store.getThread('committed')?.threadId).toBe('committed');expect(()=>row(store,'second')).toThrow('multi_agent_transaction_outcome_unknown');
    expect(reader.prepare('SELECT thread_id FROM thread_bindings WHERE thread_id=?').get('second')).toBeUndefined();
  });
  it('preserves body first cause even when rollback SDK also fails and fences that instance',()=>{
    const {store,reader}=setup(),exec=DatabaseSync.prototype.exec,first=Error('body-first'),secondary=Error('rollback-after-native');
    const hook=vi.spyOn(DatabaseSync.prototype,'exec').mockImplementation(function(this:DatabaseSync,sql:string){const result=exec.call(this,sql);if(sql==='ROLLBACK')throw secondary;return result;});
    const outcome=thrown(()=>store.transaction(port=>{row(port as DesktopMultiAgentStore,'rolled');throw first;}));hook.mockRestore();
    expect(outcome.value).toBe(first);expect(reader.prepare('SELECT count(*) AS n FROM thread_bindings').get()).toMatchObject({n:0});
    expect(()=>row(store,'second')).toThrow('multi_agent_transaction_outcome_unknown');
  });
  it('does not attempt ROLLBACK after a known commit when notification publication fails',()=>{
    const {store,reader}=setup(),failure=Error('notification-failed'),calls:string[]=[];const exec=DatabaseSync.prototype.exec;
    vi.spyOn(DatabaseSync.prototype,'exec').mockImplementation(function(this:DatabaseSync,sql:string){calls.push(sql);return exec.call(this,sql);});
    vi.spyOn(store as unknown as {publishCommitted():void},'publishCommitted').mockImplementation(()=>{throw failure;});
    expect(thrown(()=>store.transaction(port=>row(port as DesktopMultiAgentStore,'committed'))).value).toBe(failure);
    expect(calls).not.toContain('ROLLBACK');expect(reader.prepare('SELECT count(*) AS n FROM thread_bindings').get()).toMatchObject({n:1});
    expect(()=>row(store,'second')).toThrow('multi_agent_transaction_outcome_unknown');
  });
  it('rejects fresh public mutation and expired port reentry during the actual COMMIT SDK',()=>{
    const {store,reader}=setup(),exec=DatabaseSync.prototype.exec;let leaked!:DesktopMultiAgentStore;const outcomes:unknown[]=[];
    const hook=vi.spyOn(DatabaseSync.prototype,'exec').mockImplementation(function(this:DatabaseSync,sql:string){if(sql==='COMMIT'){
      outcomes.push(thrown(()=>row(store,'reentry')).value);outcomes.push(thrown(()=>row(leaked,'expired')).value);
    }return exec.call(this,sql);});
    store.transaction(port=>{leaked=port as DesktopMultiAgentStore;row(leaked,'original');});hook.mockRestore();
    expect(String(outcomes[0])).toContain('multi_agent_transaction_committing');expect(String(outcomes[1])).toMatch(/port|owner|expired/);
    expect(reader.prepare('SELECT thread_id FROM thread_bindings ORDER BY thread_id').all()).toEqual([{thread_id:'original'}]);
  });
  it('rejects public mutation reentry during ROLLBACK and keeps original failure',()=>{
    const {store,reader}=setup(),exec=DatabaseSync.prototype.exec,failure=Error('body-failed');let reentry:unknown;
    const hook=vi.spyOn(DatabaseSync.prototype,'exec').mockImplementation(function(this:DatabaseSync,sql:string){if(sql==='ROLLBACK')reentry=thrown(()=>row(store,'rollback-reentry')).value;return exec.call(this,sql);});
    expect(thrown(()=>store.transaction(()=>{throw failure;})).value).toBe(failure);hook.mockRestore();
    expect(String(reentry)).toContain('multi_agent_transaction_rolling_back');expect(reader.prepare('SELECT count(*) AS n FROM thread_bindings').get()).toMatchObject({n:0});row(store,'after-known-rollback');
  });
  it('does not allow a BEGIN wrapper to start an independent mutation before the admitted body',()=>{
    const {store,reader}=setup(),exec=DatabaseSync.prototype.exec;let entered=false,reentry:unknown;
    const hook=vi.spyOn(DatabaseSync.prototype,'exec').mockImplementation(function(this:DatabaseSync,sql:string){if(sql==='BEGIN IMMEDIATE'&&!entered){entered=true;reentry=thrown(()=>store.transaction(port=>row(port as DesktopMultiAgentStore,'begin-reentry'))).value;}return exec.call(this,sql);});
    store.transaction(port=>row(port as DesktopMultiAgentStore,'original'));hook.mockRestore();
    expect(String(reentry)).toContain('multi_agent_transaction_beginning');expect(reader.prepare('SELECT thread_id FROM thread_bindings').all()).toEqual([{thread_id:'original'}]);
  });
  it('keeps legitimate post-COMMIT subscriber transactions independent from the expired original port',()=>{
    const {store}=setup();row(store,'thread');const group=store.createGroup('thread');let called=false,expired:unknown;let original!:DesktopMultiAgentStore;
    const stop=store.subscribe(()=>{if(called)return;called=true;expired=thrown(()=>row(original,'old-port')).value;store.transaction(port=>row(port as DesktopMultiAgentStore,'notification'));});
    try{store.transaction(port=>{original=port as DesktopMultiAgentStore;port.appendEvent(group.groupId,{kind:'cleanup',agentId:'root_'+group.groupId,payload:{fixture:true}});});}finally{stop();}
    expect(called).toBe(true);expect(String(expired)).toMatch(/port|owner|expired/);expect(store.getThread('notification')?.threadId).toBe('notification');expect(store.getThread('old-port')).toBeNull();
  });
  it('retains normal rollback/reuse and nested transaction semantics',()=>{
    const {store}=setup(),failure=Error('body-known');expect(thrown(()=>store.transaction(port=>{row(port as DesktopMultiAgentStore,'rolled');throw failure;})).value).toBe(failure);
    expect(store.getThread('rolled')).toBeNull();
    expect(store.transaction(port=>port.transaction(nested=>{row(nested as DesktopMultiAgentStore,'nested');return 42;}))).toBe(42);
    row(store,'after');expect(store.getThread('nested')).not.toBeNull();expect(store.getThread('after')).not.toBeNull();
  });
});
