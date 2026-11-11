// Actual continuity database owner: per-statement custody stays bounded, and a
// statement whose result is not physically known keeps its custody and fences
// every later call.
import {afterEach,beforeAll,expect,it,vi} from 'vitest';
import {StatementSync} from 'node:sqlite';
import {mkdtempSync,rmSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

// Observe (never replace) each actual custody's own physical assertion, so the
// owner's retained statement custody is countable from outside the module.
const custody=vi.hoisted(()=>({assertions:0,created:[] as Array<{asserted:number;rejected:number}>}));
vi.mock('../../../src/runtime/verification/original-sdk-custody.js',async importOriginal=>{
  const actual=await importOriginal<typeof import('../../../src/runtime/verification/original-sdk-custody.js')>();
  return {...actual,createRoomTurnCustody:()=>{
    const stock=actual.createRoomTurnCustody(),tally={asserted:0,rejected:0};custody.created.push(tally);
    return Object.freeze({...stock,assertPhysicalKnown:()=>{custody.assertions++;tally.asserted++;try{return stock.assertPhysicalKnown();}catch(error){tally.rejected++;throw error;}}});
  }};
});

// The owner captures StatementSync.prototype.get when it loads; the poison flag
// lets one actual Native row come back carrying a thenable.
const nativeGet=StatementSync.prototype.get;let poison=false;
let openContinuityDatabase!:typeof import('../../electron/context-continuity/database-owner.js').openContinuityDatabase;
beforeAll(async()=>{
  StatementSync.prototype.get=function(this:StatementSync,...args:unknown[]){
    const row=Reflect.apply(nativeGet,this,args) as Record<string,unknown>;
    return poison?Object.assign(Object.create(null),row,{then:()=>undefined}):row;
  } as typeof nativeGet;
  try{({openContinuityDatabase}=await import('../../electron/context-continuity/database-owner.js'));}
  finally{StatementSync.prototype.get=nativeGet;}
});

const roots:string[]=[];const dbs:Array<{close():void}>=[];
afterEach(()=>{poison=false;for(const db of dbs.splice(0))try{db.close();}catch{/* a fenced owner reports its own unknown close */}for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
function open(){
  const root=realpathSync(mkdtempSync(join(tmpdir(),'xiaok-continuity-db-owner-')));roots.push(root);
  const db=openContinuityDatabase(join(root,'continuity.sqlite'));dbs.push(db);
  db.exec('CREATE TABLE probe(id INTEGER PRIMARY KEY, v TEXT)');return db;
}
/** Custody assertions one ordinary later call performs; equals the retained stock count plus a constant. */
function assertionsForOneCall(db:ReturnType<typeof open>):number{
  const statement=db.prepare('SELECT count(*) AS n FROM probe');const before=custody.assertions;statement.get();return custody.assertions-before;
}
function burst(db:ReturnType<typeof open>,n:number){
  for(let i=0;i<n;i++){
    const kind=i%4;
    if(kind===0)db.prepare('INSERT INTO probe(v) VALUES(?)').run(`v${i}`);
    else if(kind===1)db.prepare('SELECT v FROM probe WHERE id=?').get(1);
    else if(kind===2)db.prepare('SELECT id FROM probe LIMIT 3').all();
    else db.exec(`UPDATE probe SET v='e${i}' WHERE id=1`);
  }
}

it('keeps per-call custody bounded: a call after 500 statements asserts no more stocks than after 50', () => {
  const small=open();burst(small,50);const afterSmall=assertionsForOneCall(small);
  const large=open();burst(large,500);const afterLarge=assertionsForOneCall(large);
  expect(afterLarge).toBe(afterSmall);
  // A further 500 statements on the same owner still leave the per-call cost unchanged.
  burst(large,500);expect(assertionsForOneCall(large)).toBe(afterSmall);
});

it('retains the custody of a statement whose result is not physically known and rejects the next call', () => {
  const db=open();db.prepare('INSERT INTO probe(v) VALUES(?)').run('a');
  const statement=db.prepare('SELECT v FROM probe WHERE id=1');
  poison=true;const firstStock=custody.created.length;
  expect(()=>statement.get()).toThrow('ROOM_TURN_SOURCE_SDK_UNCONFIRMED');
  poison=false;
  // Exactly one custody created by that call refused its own physical proof: the statement's stock.
  const unknown=custody.created.slice(firstStock).filter(stock=>stock.rejected>0);
  expect(unknown).toHaveLength(1);const [unknownStock]=unknown;const rejectedAtFailure=unknownStock!.rejected;
  // The next ordinary call re-asserts that retained stock in check() and is rejected before any SQL.
  expect(()=>db.prepare('SELECT 1 AS ok')).toThrow('ROOM_TURN_SOURCE_SDK_UNCONFIRMED');
  expect(unknownStock!.rejected).toBe(rejectedAtFailure+1);
  expect(()=>statement.get()).toThrow('ROOM_TURN_SOURCE_SDK_UNCONFIRMED');
  expect(()=>db.exec('SELECT 1')).toThrow('ROOM_TURN_SOURCE_SDK_UNCONFIRMED');
  expect(unknownStock!.rejected).toBe(rejectedAtFailure+3);
});
