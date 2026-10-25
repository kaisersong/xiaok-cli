import {AsyncResource} from 'node:async_hooks';
/** Scheduling primitive only. This queue issues no execution, publication or
 * quiescence authority. Product adapters must authenticate actual owners and
 * keep work pending until their real publication/transport obligations finish. */
export interface ProducerQueueScope { readonly opaqueProducerQueueScope: never }
export interface ProducerQueueWindow {
 readonly drained: Promise<void>;
 handoff<T>(work:(scope:ProducerQueueScope)=>Promise<T>):Promise<T>;
 release():void;
 cancel(error:unknown):void;
 fail(error:unknown):void;
}
const LIMIT=512;
export function createProducerWindowQueue(){
 type Scope={token:ProducerQueueScope;open:boolean;bodyDone:boolean;detached:boolean;releaseRequested:boolean;finished:boolean;children:Set<Promise<unknown>>;childFailure?:{error:unknown}};
 type Waiting={start():void;reject(error:unknown):void;signal?:AbortSignal;abort():void};
 const scopes=new WeakMap<object,Scope>(),active=new Set<Scope>(),waiting=new Set<Waiting>();
 let slots=0,failure:{error:unknown}|undefined;
 let current:{phase:'closing'|'held'|'handoff';resolve():void;reject(error:unknown):void;settled:boolean}|undefined;
 const maybeDrained=()=>{if(current&&!current.settled&&!active.size){current.settled=true;current.phase='held';current.resolve();}};
 const setFailure=(error:unknown)=>{failure??={error};const window=current;current=undefined;if(window&&!window.settled){window.settled=true;window.reject(failure.error);}for(const entry of [...waiting])entry.reject(failure.error);};
 const finishScope=(scope:Scope)=>{if(scope.finished)return;scope.finished=true;scopes.delete(scope.token);active.delete(scope);slots--;maybeDrained();};
 const reserve=()=>{if(slots>=(current?LIMIT-1:LIMIT))throw Error('producer_window_capacity');slots++;};
 const execute=async<T>(work:(scope:ProducerQueueScope)=>Promise<T>):Promise<T>=>{
  const token=Object.freeze({}) as ProducerQueueScope,scope:Scope={token,open:true,bodyDone:false,detached:false,releaseRequested:false,finished:false,children:new Set()};scopes.set(token,scope);active.add(scope);
  try{
   let value:T|undefined,problem:{error:unknown}|undefined;
   try{value=await work(token);}catch(error){problem={error};}finally{scope.open=false;}
   while(scope.children.size)await Promise.allSettled([...scope.children]);
   if(problem||scope.childFailure){const error=(problem??scope.childFailure)!.error;if(scope.detached)setFailure(error);throw error;}return value as T;
  }finally{scope.bodyDone=true;if(!scope.detached||scope.releaseRequested)finishScope(scope);}
 };
 const run=<T>(work:(scope:ProducerQueueScope)=>Promise<T>,signal?:AbortSignal):Promise<T>=>{
  work=AsyncResource.bind(work);
  try{if(failure)throw failure.error;signal?.throwIfAborted();reserve();}catch(error){return Promise.reject(error);}
  if(!current)return execute(work);
  return new Promise<T>((resolve,reject)=>{
   let consumed=false;
   const remove=()=>{waiting.delete(entry);signal?.removeEventListener('abort',entry.abort);};
   const entry:Waiting={signal,start(){if(consumed)return;consumed=true;remove();void execute(work).then(resolve,reject);},
    reject(error){if(consumed)return;consumed=true;remove();slots--;reject(error);},abort(){entry.reject(signal?.reason??Error('producer_window_aborted'));}};
   waiting.add(entry);signal?.addEventListener('abort',entry.abort,{once:true});if(signal?.aborted)entry.abort();
  });
 };
 return Object.freeze({run,fail:setFailure,
  /** Transfer scheduling ownership to an authenticated publication adapter.
   * This primitive's completion method itself is not a physical receipt. */
  transfer(token:ProducerQueueScope):Readonly<{run<T>(work:()=>Promise<T>):Promise<T>;complete():void;fail(error:unknown):void}>{
   const scope=token&&typeof token==='object'?scopes.get(token):undefined;
   if(!scope?.open||scope.detached)throw Error('producer_scope_not_current');scope.detached=true;let consumed=false,running=false;
   return Object.freeze({
    async run<T>(work:()=>Promise<T>):Promise<T>{
     if(consumed)throw Error('producer_publication_already_consumed');if(running)throw Error('producer_publication_running');if(failure)throw failure.error;
     running=true;try{return await work();}catch(error){consumed=true;setFailure(error);throw error;}finally{running=false;}
    },
    complete(){if(consumed)throw Error('producer_publication_already_consumed');if(running)throw Error('producer_publication_running');consumed=true;scope.releaseRequested=true;if(scope.bodyDone)finishScope(scope);},
    fail(error:unknown){if(consumed)throw Error('producer_publication_already_consumed');consumed=true;setFailure(error);},
   });
  },
  inherit<T>(token:ProducerQueueScope,work:(scope:ProducerQueueScope)=>Promise<T>):Promise<T>{
   const parent=token&&typeof token==='object'?scopes.get(token):undefined;
   try{if(!parent?.open)throw Error('producer_scope_not_current');if(failure)throw failure.error;if(slots>=LIMIT)throw Error('producer_window_capacity');slots++;}catch(error){return Promise.reject(error);}
   const child=execute(work);parent.children.add(child);
   void child.then(()=>parent.children.delete(child),error=>{parent.childFailure??={error};parent.children.delete(child);});return child;
  },
  closeAdmission():ProducerQueueWindow{
   if(failure)throw failure.error;if(current)throw Error('producer_window_already_open');
   let resolve!:()=>void,reject!:(error:unknown)=>void;const drained=new Promise<void>((yes,no)=>{resolve=yes;reject=no;});
   // The owner may cancel before it awaits drain. Keep that legitimate ordering
   // from producing an unhandled rejection; callers still receive the rejection.
   void drained.catch(()=>{});
   const window={phase:'closing' as 'closing'|'held'|'handoff',resolve,reject,settled:false};current=window;maybeDrained();
   return Object.freeze({drained,
    handoff<T>(work:(scope:ProducerQueueScope)=>Promise<T>):Promise<T>{
     if(failure)return Promise.reject(failure.error);
     if(current!==window||window.phase!=='held')return Promise.reject(Error('producer_window_handoff_not_current'));
     window.phase='handoff';slots++;return execute(work);
    },
    release(){if(current!==window||window.phase==='closing')throw Error('producer_window_not_drained');current=undefined;for(const entry of [...waiting])queueMicrotask(()=>entry.start());},
    cancel(error:unknown){if(current!==window||window.phase==='handoff')throw Error('producer_window_cannot_cancel');current=undefined;if(!window.settled){window.settled=true;window.reject(error);}for(const entry of [...waiting])queueMicrotask(()=>entry.start());},
    fail(error:unknown){if(current!==window)return;setFailure(error);},
   });
  },
 });
}
