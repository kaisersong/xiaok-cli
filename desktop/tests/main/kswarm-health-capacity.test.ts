import {expect,it} from 'vitest';import {DatabaseSync} from 'node:sqlite';import {KSwarmServiceHealthScanner} from '../../electron/kswarm-health-loop.js';
it.each([false,true])('does not replace a real SQLite FULL failure with a persisted source-unavailable result (async=%s)',async asynchronous=>{
 const input={expectedEntryPath:'x'.repeat(128*1024),spawnEntryExists:false,port:{listening:false},health:{ok:false},broker:{ok:false}};const scanner=new KSwarmServiceHealthScanner(':memory:',{probe:()=>asynchronous?Promise.resolve(input):input});const db=(scanner as unknown as {db:DatabaseSync}).db;
 try{const pages=Number(db.prepare('PRAGMA page_count').get()?.page_count);db.exec('PRAGMA max_page_count='+pages);const before=db.prepare('SELECT * FROM evidence_anomalies').all();let error:unknown;try{await scanner.scan({now:1});}catch(value){error=value;}expect(String(error)).toMatch(/full/i);expect(db.prepare('SELECT * FROM evidence_anomalies').all()).toEqual(before);expect(db.isTransaction).toBe(false);}finally{scanner.close();}
});
it('retains the live scanner lease when a synchronous probe reenters close',()=>{
 let closeError:unknown;let scanner!:KSwarmServiceHealthScanner;scanner=new KSwarmServiceHealthScanner(':memory:',{probe(){try{scanner.close();}catch(error){closeError=error;}return{expectedEntryPath:null,spawnEntryExists:false,port:{listening:false},health:{ok:false},broker:{ok:false}};}});
 try{expect(scanner.scan({now:1})).toHaveProperty('openAnomalyCount');expect(String(closeError)).toContain('loop_scanner_not_drained');expect(()=>scanner.scan()).toThrow('loop_scanner_closed');}finally{scanner.close();}
});
