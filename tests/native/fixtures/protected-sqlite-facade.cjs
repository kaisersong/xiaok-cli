const assert = require('node:assert/strict');
const {join} = require('node:path');
exports.run = async function(root, scenario) {
  const native=require(join(root,'protected_sqlite.node'));
  const {wrapOriginalProtectedSQLiteNamespace,readOriginalProtectedSQLiteNamespace}=require(join(root,'index.cjs'));
  let core,api,db,primary,failed=false,proxyTraps=0;
  try{
    core=native.openOriginalRootIoComponent();api=wrapOriginalProtectedSQLiteNamespace(core);db=new api.Database();
    if (scenario === 'identity_loss') {
      let calls=0; db.function('sql_probe',()=>++calls);
      const cached=db.prepare('SELECT sql_probe() AS n'); assert.equal(cached.get().n,1);
      const fs=require('node:fs'), file=join(root,'authority/root-resource.sqlite'), held=file+'.held';
      fs.renameSync(file,held);
      assert.throws(()=>cached.get(),e=>e.code==='ERR_SQLITE_ERROR');
      assert.equal(calls,1,'invalidated original IO must prevent even cached SQLite step');
      fs.renameSync(held,file);
      assert.throws(()=>cached.get(),e=>e.code==='ERR_SQLITE_ERROR');
      assert.equal(calls,1,'restoring pathname never revives the old database');
      assert.throws(()=>db.close()); assert.throws(()=>api.closeOwned());
      assert.throws(()=>native.finishOriginalComponent(core));
      const fate=native.readOriginalComponentFate(core);
      assert.equal(fate.unknown,true); assert.equal(fate.rootFilesClosed,false);
      console.log(JSON.stringify({kind:'protected-sqlite-facade-component',success:true,scenario,proxyTraps,unknown:fate.unknown,rootFilesClosed:fate.rootFilesClosed,productionQualified:false}));
      return;
    }
    if (scenario === 'cursor_gc') {
      // V8 GC in this Node isolate, not an OS/guest VM or Electron process.
      require('node:v8').setFlagsFromString('--expose-gc');
      const collect=require('node:vm').runInNewContext('gc');
      const q=db.prepare('SELECT 1 AS n');let cursor=q.beginIterator();
      let oldReturn=cursor.return, oldNext=cursor.next;
      const weak=new WeakRef(cursor);cursor=null;
      for(let i=0;i<8;i++){await new Promise(setImmediate);collect();await new Promise(setImmediate);}
      let original=weak.deref();
      if(original)oldReturn.call(original);
      let accepted=0,denied=0;
      for(let i=0;i<100&&accepted===0;i++){
        const fresh=q.beginIterator();fresh.next();
        try{oldReturn.call(fresh);accepted++;}catch{denied++;}
        try{oldNext.call(fresh);accepted++;}catch{denied++;}
        fresh.return();
        if(i%10===0){await new Promise(setImmediate);collect();}
      }
      console.log(JSON.stringify({kind:'protected-sqlite-cursor-gc',originalRetained:original!==undefined,accepted,denied}));
      assert.equal(accepted,0,'old Native method must never acquire a fresh cursor by recycled address');
      assert.notEqual(original,undefined,'method must retain its original JS cursor until method GC');
      original=null;oldReturn=null;oldNext=null;
      for(let i=0;i<8;i++){await new Promise(setImmediate);collect();await new Promise(setImmediate);}
      assert.equal(weak.deref(),undefined,'dropping both methods must allow the cursor cycle to be collected');
      api.closeOwned();const fate=native.finishOriginalComponent(core);
      console.log(JSON.stringify({kind:'protected-sqlite-facade-component',success:true,scenario,proxyTraps,unknown:fate.unknown,rootFilesClosed:fate.rootFilesClosed,productionQualified:false}));return;
    }
    assert.equal(api.transactionStateGetter.call(db),false);assert.equal(db.isTransaction,false);
    assert.equal(Object.getOwnPropertyDescriptor(db,'isTransaction').configurable,false);
    const before=native.readOriginalComponentFate(core).rootSequence;
    assert.throws(()=>new api.Database());assert.throws(()=>new api.Statement());
    assert.equal(native.readOriginalComponentFate(core).rootSequence,before);
    const p=new Proxy({}, {get(){proxyTraps++;throw Error('getter');},getOwnPropertyDescriptor(){proxyTraps++;throw Error('descriptor');},ownKeys(){proxyTraps++;throw Error('keys');},getPrototypeOf(){proxyTraps++;throw Error('prototype');}});
    assert.throws(()=>api.databaseMethods.exec.call(p,'SELECT 1'));
    assert.throws(()=>api.statementMethods.get.call(p));
    assert.throws(()=>wrapOriginalProtectedSQLiteNamespace(p));
    assert.equal(readOriginalProtectedSQLiteNamespace(api,core),api);
    assert.throws(()=>readOriginalProtectedSQLiteNamespace(p,core));
    assert.throws(()=>readOriginalProtectedSQLiteNamespace(api,p));
    const production=require(join(root,'production_sqlite.node'));
    assert.equal(production.openOriginalRootIoComponent,undefined);
    assert.throws(()=>production.assertOriginalNamespace(core),'another addon cannot borrow the fixture registry');
    assert.throws(()=>production.assertOriginalNamespace(p));

    assert.throws(()=>db.function('bad',p,()=>1));
    let getter=0;assert.throws(()=>db.function('bad',{get deterministic(){getter++;return true;}},()=>1));assert.equal(getter,0);
    db.exec('CREATE TABLE evidence(id INTEGER PRIMARY KEY, body TEXT, bytes BLOB); BEGIN IMMEDIATE;');assert.equal(db.isTransaction,true);
    const insert=db.prepare('INSERT INTO evidence(body,bytes) VALUES(?,?)');assert.equal(insert.run('hello\0世界',new Uint8Array([0,255])).changes,1);
    db.exec('COMMIT');assert.equal(db.isTransaction,false);
    const row=db.prepare('SELECT body,bytes,1 AS "__proto__" FROM evidence').get();assert.equal(Object.getPrototypeOf(row),null);assert.equal(row.body,'hello\0世界');assert.deepEqual([...row.bytes],[0,255]);assert.equal(row.__proto__,1);
    assert.equal(db.prepare('SELECT body FROM evidence WHERE id=99').get(),undefined);
    const projection=db.prepare('SELECT 9 AS n'), originalIterator=Object.getOwnPropertyDescriptor(Array.prototype,Symbol.iterator);
    let iteratorGets=0, projectionFailed=false, projected;
    Object.defineProperty(Array.prototype,Symbol.iterator,{configurable:true,get(){iteratorGets++;throw undefined;}});
    try { projected=projection.get(); } catch { projectionFailed=true; }
    finally { Object.defineProperty(Array.prototype,Symbol.iterator,originalIterator); }
    assert.equal(iteratorGets,0,'projection must not read a mutable inherited iterator');
    assert.equal(projectionFailed,false);assert.equal(projected.n,9);

    assert.throws(()=>db.prepare('SELECT ?').get(p));
    const big=db.prepare('SELECT 9223372036854775807 AS value');assert.throws(()=>big.get(),e=>e.code==='ERR_OUT_OF_RANGE');big.setReadBigInts(true);assert.equal(big.get().value,9223372036854775807n);
    let depth=0;db.function('guard',{deterministic:false},()=>depth);db.exec('CREATE TRIGGER gate BEFORE INSERT ON evidence BEGIN SELECT CASE WHEN guard() IS NOT 1 THEN RAISE(ABORT,\'guard\') END; END;');
    assert.throws(()=>insert.run('denied',null),e=>e.code==='ERR_SQLITE_ERROR'&&e.message==='guard');depth=1;insert.run('allowed',null);
    db.function('nullish',()=>undefined);assert.equal(db.prepare('SELECT nullish() AS n').get().n,null);
    for(const value of [undefined,new Error('original'),Object.defineProperty({},Symbol('tail'),{value:Promise.resolve('held')})]){
      db.function('throw_value',()=>{throw value;});
      for (const method of ['get','all','run','exec']) {
        let seen=false,error;
        try { if(method==='exec') db.exec('SELECT throw_value()'); else db.prepare('SELECT throw_value()')[method](); }
        catch(e){seen=true;error=e;}
        assert.equal(seen,true);assert.equal(error,value);
      }
    }
    let thenGets=0;db.function('bad_result',()=>({get then(){thenGets++;return ()=>{};}}));assert.throws(()=>db.prepare('SELECT bad_result()').get());assert.equal(thenGets,0);
    db.exec('CREATE TABLE redacted(x); CREATE TRIGGER redact BEFORE INSERT ON redacted BEGIN SELECT RAISE(ABORT,\'original-root-store:0xdeadbeef\'); END;');assert.throws(()=>db.exec('INSERT INTO redacted VALUES(1)'),e=>e.code==='ERR_SQLITE_ERROR'&&!e.message.includes('0xdeadbeef')&&!e.message.includes('original-root'));
    assert.throws(()=>db.exec('ATTACH \':memory:\' AS other'));assert.throws(()=>db.exec('PRAGMA journal_mode=WAL'));
    const q=db.prepare('SELECT id FROM evidence ORDER BY id');for(const value of q.iterate()){assert.equal(value.id,1);break;}assert.equal(q.all().length,2);
    const cursor=q.iterate();assert.equal(cursor.next().done,false);assert.throws(()=>db.close(),e=>e.code==='ERR_SQLITE_ERROR');cursor.return();db.close();db=undefined;
    api.closeOwned();const fate=native.finishOriginalComponent(core);
    console.log(JSON.stringify({kind:'protected-sqlite-facade-component',success:true,proxyTraps,unknown:fate.unknown,rootFilesClosed:fate.rootFilesClosed,productionQualified:false}));
  }catch(e){failed=true;primary=e;}
  finally{if(failed){try{api?.closeOwned();}catch(cleanup){console.error('CLEANUP',cleanup);}try{if(core)native.finishOriginalComponent(core);}catch(cleanup){console.error('CLIENT_CLEANUP',cleanup);}}}
  if(failed){console.error(primary);process.exitCode=1;}
};
