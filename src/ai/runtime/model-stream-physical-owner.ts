/** Fixed host lifetime. Counts original model promises, never outward races. */
export interface ModelReadReceipt {consume():void; classifyFailure(error:unknown):void}
export interface ModelStreamPhysicalRun {
 observeRead<T>(raw:Promise<T>,knownReasons:()=>readonly unknown[]):ModelReadReceipt;
 observeReturn<T>(raw:Promise<T>):void;
 noteReturnFailure(error:unknown):void;
 finish():void;
}
export class ModelStreamPhysicalOwner {
 private readonly stopping=new AbortController();
 private sealed=false;
 private readonly claims=new Set<object>();
 private readonly raw=new Set<object>();
 private readonly failures:unknown[]=[];
 private readonly waiters=new Set<{resolve():void;reject(error:unknown):void}>();
 private closure:Promise<void>|undefined;
 get signal():AbortSignal{return this.stopping.signal;}
 hasPending():boolean{return this.claims.size>0||this.raw.size>0;}
 hasFailure():boolean{return this.failures.length>0;}
 admit():ModelStreamPhysicalRun {
  if(this.sealed)throw Error('agent_model_ingress_closed');
  if(this.failures.length)throw Error('agent_model_cleanup_unconfirmed');
  const claim={};this.claims.add(claim);
  const current=()=>{if(!this.claims.has(claim))throw Error('agent_model_claim_retired');};
  const failure=(error:unknown)=>{this.failures.push(error);};
  return Object.freeze({
   observeRead:<T>(raw:Promise<T>,knownReasons:()=>readonly unknown[]):ModelReadReceipt=>{
    current();let outcome:'pending'|'fulfilled'|'rejected'='pending',reason:unknown;
    let classification:'pending'|'consumed'|'failed'='pending',visibleError:unknown,recorded=false;
    const classify=()=>{if(recorded||outcome!=='rejected'||classification!=='failed')return;
     recorded=true;if(reason!==visibleError&&!knownReasons().some(known=>known!==undefined&&known===reason))failure(reason);
    };
    const receipt={};this.raw.add(receipt);
    const settle=()=>{
     if(outcome==='pending'||classification==='pending')return;
     classify();this.raw.delete(receipt);this.checkIdle();
    };
    void raw.then(()=>{outcome='fulfilled';settle();},error=>{outcome='rejected';reason=error;settle();});
    return Object.freeze({
     consume(){if(classification!=='pending')return;classification='consumed';settle();},
     classifyFailure(error:unknown){if(classification!=='pending')return;classification='failed';visibleError=error;settle();},
    });
   },
   observeReturn:<T>(raw:Promise<T>)=>{current();this.track(raw,()=>{},failure);},
   noteReturnFailure:(error:unknown)=>{current();failure(error);},
   finish:()=>{this.claims.delete(claim);this.checkIdle();},
  });
 }
 stop(reason?:unknown):void {
  if(this.sealed)return;this.sealed=true;
  this.closure=this.waitForIdle();
  // A caller may attach later; this handler observes without replacing the
  // original sticky rejected closure returned by waitForStopped().
  void this.closure.catch(()=>{});
  this.stopping.abort(reason);this.checkIdle();
 }
 waitForStopped():Promise<void>{return this.sealed?this.closure!:Promise.reject(Error('agent_model_stop_not_started'));}
 waitForIdle():Promise<void>{return new Promise<void>((resolve,reject)=>{this.waiters.add({resolve,reject});this.checkIdle();});}
 private track<T>(raw:Promise<T>,fulfilled:()=>void,rejected:(error:unknown)=>void):void {
  // Promise identity is not operation identity: a legal iterator may reuse
  // the same original Promise for next/return or concurrent owner receipts.
  const receipt={};this.raw.add(receipt);
  void raw.then(()=>{fulfilled();this.raw.delete(receipt);this.checkIdle();},error=>{rejected(error);this.raw.delete(receipt);this.checkIdle();});
 }
 private checkIdle():void {
  if(this.hasPending())return;
  const error=this.failures.length?new AggregateError([...this.failures],'agent_model_physical_drain_unconfirmed'):undefined;
  for(const waiter of this.waiters){if(error)waiter.reject(error);else waiter.resolve();}this.waiters.clear();
 }
}
