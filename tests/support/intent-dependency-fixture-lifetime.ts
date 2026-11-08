/** Test infrastructure only: negative cleanup custody, never a Source or grant. */
type Closeable={close(preserveRoot?:boolean):unknown};
type Failure={raw:unknown};
type Row={base?:Closeable;fixture?:Closeable;receiver?:Closeable;fixtureRaw?:Promise<Closeable>;receiverRaw?:Promise<Closeable>;failure?:Failure;incomplete:boolean;closing?:Promise<void>;errors:unknown[]};
const members=new WeakMap<object,Row>(),held=new Set<Row>();

/** Fixed passive birth capture called by the original fixture immediately after
 * its installed base is returned. No callback or positive permission is issued. */
export function captureIntentDependencyFixtureBase(owner:object|undefined,base:Closeable):void{
 if(owner===undefined)return;
 const row=members.get(owner);if(!row||row.base||row.closing)throw Error('intent_dependency_fixture_owner');
 row.base=base;
}
export function createIntentDependencyFixtureLifetime(){
 const row:Row={incomplete:false,errors:[]};held.add(row);
 const owner=Object.freeze({
  async captureFixture<T extends Closeable>(raw:Promise<T>):Promise<T>{
   if(row.fixtureRaw||row.closing)throw Error('intent_dependency_fixture_duplicate');
   row.fixtureRaw=raw;
   try{const value=await raw;row.fixture=value;return value;}catch(error){row.incomplete=true;throw error;}
  },
  async captureReceiver<T extends Closeable>(raw:Promise<T>):Promise<T>{
   if(row.receiverRaw||row.closing)throw Error('intent_dependency_fixture_duplicate');
   row.receiverRaw=raw;
   try{const value=await raw;row.receiver=value;return value;}catch(error){row.incomplete=true;throw error;}
  },
  fail(raw:unknown){row.failure??={raw};},
  close():Promise<void>{
   if(row.closing)return row.closing;
   let resolve!:()=>void,reject!:(raw:unknown)=>void;
   row.closing=new Promise<void>((ok,no)=>{resolve=ok;reject=no;});
   // Publish the single-flight slot before any original close can reenter.
   const closing=(async()=>{
    try{await row.receiver?.close();}catch(raw){row.errors.push(raw);}
    let fixtureFailed=false;
    if(row.fixture)try{await row.fixture.close(row.incomplete||row.failure!==undefined||row.errors.length>0);}catch(raw){row.errors.push(raw);fixtureFailed=true;}
    if(row.base&&(!row.fixture||fixtureFailed))try{await row.base.close(true);}catch(raw){row.errors.push(raw);}
    if(row.errors.length){const failures=row.failure?[row.failure.raw,...row.errors]:row.errors;throw new AggregateError(failures,'intent_dependency_fixture_cleanup_unknown',{cause:failures[0]});}
    if(!row.incomplete&&row.failure===undefined)held.delete(row);
   })();
   void closing.then(resolve,reject);
   return row.closing;
  },
 });
 members.set(owner,row);return owner;
}
